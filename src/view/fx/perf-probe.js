// ─────────────────────────────────────────────────────────────────────────────
// PERF PROBE (dev instrumentation) — press **P** to copy a "graphical load"
// snapshot to the clipboard for auditing.
//
// It runs its own rAF loop measuring real frame times (a jank on the main thread
// stretches the rAF interval, so this is a faithful FPS proxy), keeps a rolling
// ~15s window, samples the FX-engine's live counts + WAAPI animation count +
// "flying VFX" DOM nodes each frame, and records long tasks (>50ms main-thread
// blocks) via PerformanceObserver. On P it compiles a text report → clipboard.
//
// Pure read-only diagnostics; never mutates game state or the FX engine.
// ─────────────────────────────────────────────────────────────────────────────

import { fx } from './fx-engine.js';

const CAP = 1200; // ring-buffer frames (~20s @ 60fps)
let started = false;

export function startPerfProbe() {
  if (started || typeof window === 'undefined') return;
  started = true;

  const dt = new Float32Array(CAP); // frame time (ms)
  const nPart = new Int16Array(CAP);
  const nImp = new Int16Array(CAP);
  const nProj = new Int16Array(CAP);
  const nShell = new Int16Array(CAP);
  const nAnim = new Int16Array(CAP); // WAAPI animations
  const nFly = new Int16Array(CAP); // will-change DOM nodes (currency/flying VFX)
  let head = 0;
  let filled = 0;
  let last = performance.now();

  // getAnimations()/querySelectorAll are a touch heavy — sample every few frames
  // and carry the last value forward so the per-frame cost stays negligible.
  let lastAnim = 0;
  let lastFly = 0;
  let domNodes = 0;
  let frame = 0;

  // Long-task recorder (main-thread blocks ≥50ms) over a rolling window.
  const longTasks = []; // { t, ms }
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ t: performance.now(), ms: Math.round(e.duration) });
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask unsupported (Safari) — the report just omits it */
  }

  const tick = (now) => {
    const d = now - last;
    last = now;
    frame++;
    if (frame % 6 === 0) {
      try { lastAnim = document.getAnimations().length; } catch { lastAnim = -1; }
      lastFly = document.querySelectorAll('[style*="will-change"]').length;
    }
    if (frame % 30 === 0) domNodes = document.getElementsByTagName('*').length;

    dt[head] = d;
    nPart[head] = fx.particles ? fx.particles.length : 0;
    nImp[head] = fx.impacts ? fx.impacts.length : 0;
    nProj[head] = fx.projectiles ? fx.projectiles.length : 0;
    nShell[head] = fx.shells ? fx.shells.length : 0;
    nAnim[head] = lastAnim;
    nFly[head] = lastFly;
    head = (head + 1) % CAP;
    if (filled < CAP) filled++;

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const report = () => {
    // Pull the last `filled` samples in chronological order.
    const idx = [];
    for (let i = 0; i < filled; i++) idx.push((head - filled + i + CAP) % CAP);
    const dts = idx.map((i) => dt[i]).filter((x) => x > 0 && x < 2000);
    if (!dts.length) return '(no frames sampled yet)';
    const sorted = [...dts].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const sum = dts.reduce((a, b) => a + b, 0);
    const avg = sum / dts.length;
    const worst = [...dts].sort((a, b) => b - a).slice(0, 10).map((x) => Math.round(x));
    const over = (thr) => dts.filter((x) => x > thr).length;
    const pct = (n) => ((100 * n) / dts.length).toFixed(1);
    const peak = (arr) => idx.reduce((m, i) => (arr[i] > m ? arr[i] : m), 0);
    const nowV = (arr) => arr[(head - 1 + CAP) % CAP];
    const windowMs = sum;

    const recentLong = longTasks.filter((l) => now0 - l.t < windowMs + 500);
    const longStr = recentLong.length
      ? `${recentLong.length} long tasks, worst ${Math.max(...recentLong.map((l) => l.ms))}ms  [${recentLong.map((l) => l.ms).slice(-12).join(', ')}]`
      : 'none recorded (or unsupported)';

    return [
      `=== MergeCombat GRAPHICAL LOAD — last ${(windowMs / 1000).toFixed(1)}s (${dts.length} frames) ===`,
      `FPS   avg ${(1000 / avg).toFixed(1)}   (worst-instant ${(1000 / Math.max(...dts)).toFixed(1)})`,
      `frame ms   median ${q(0.5).toFixed(1)}   p95 ${q(0.95).toFixed(1)}   p99 ${q(0.99).toFixed(1)}   max ${Math.max(...dts).toFixed(1)}`,
      `janky frames   >16.7ms ${over(16.7)} (${pct(over(16.7))}%)   >33ms ${over(33)} (${pct(over(33))}%)   >50ms ${over(50)}`,
      `worst 10 frames (ms)   ${worst.join(', ')}`,
      `long tasks   ${longStr}`,
      ``,
      `FX canvas   particles peak ${peak(nPart)} / now ${nowV(nPart)}   impacts peak ${peak(nImp)} / now ${nowV(nImp)}   trails peak ${peak(nProj)} / now ${nowV(nProj)}   shells peak ${peak(nShell)} / now ${nowV(nShell)}`,
      `WAAPI anims   peak ${peak(nAnim)} / now ${nowV(nAnim)}`,
      `flying-VFX DOM (will-change)   peak ${peak(nFly)} / now ${nowV(nFly)}`,
      `total DOM nodes   ${domNodes}`,
      ``,
      `device   DPR ${window.devicePixelRatio || 1} (fx caps at 2)   viewport ${window.innerWidth}x${window.innerHeight}   cores ${navigator.hardwareConcurrency || '?'}`,
      `canvas   ${fx.W || '?'}x${fx.H || '?'} css → ${Math.round((fx.W || 0) * (fx.DPR || 1))}x${Math.round((fx.H || 0) * (fx.DPR || 1))} px   fx.DPR ${fx.DPR}`,
      `ua   ${navigator.userAgent}`,
      ``,
      `chest lifecycles (last ${(window.__chestLog || []).length}):`,
      (window.__chestLog && window.__chestLog.length)
        ? JSON.stringify(window.__chestLog, null, 2)
        : '(no chest landed since load — fulfil an order, then press P)',
    ].join('\n');
  };

  let now0 = 0;
  const copy = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallback(text));
    } else {
      fallback(text);
    }
  };
  const fallback = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  };
  const toast = (msg) => {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(8,12,24,.94);color:#bfe;font:600 13px/1.3 system-ui,sans-serif;' +
      'padding:9px 14px;border-radius:10px;border:1px solid rgba(120,255,200,.4);pointer-events:none;';
    document.body.appendChild(t);
    t.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1800 })
      .onfinish = () => t.remove();
  };

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'p' && e.key !== 'P') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    now0 = performance.now();
    const text = report();
    copy(text);
    toast('📋 Graphical load copied — paste it to Claude');
    // Also log it, so it's recoverable even if the clipboard write is blocked.
    // eslint-disable-next-line no-console
    console.log(text);
  });
}
