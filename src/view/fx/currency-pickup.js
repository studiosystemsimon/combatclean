// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY EXPLOSION (view layer) — burst → hang → arc(bezier) → tally-bounce,
// ported from FrogGame currency-pickup-anim.js + the cascade-queue 300ms stagger.
// DOM emoji icons in a fixed overlay; targets header stats by [data-stat].
// Feedback only — the reducer already granted the currency; this never mutates.
// ─────────────────────────────────────────────────────────────────────────────

import { rand, clamp, easeOutBack, easeInQuad, easeOutCubic, bezier2 } from './fx-math.js';
import { startBurst, incrementDisplay, finishBurst, getDisplay } from './counter-tween.js';
import { REVEAL } from '../../data/config.js';

const CU = REVEAL.currency;

let _container = null;
function container() {
  if (_container) return _container;
  _container = document.createElement('div');
  Object.assign(_container.style, {
    position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden',
  });
  document.body.appendChild(_container);
  return _container;
}

// Cascade sequencer: back-to-back bursts start ≥staggerMs apart (cascade-queue.js).
const STAGGER_MS = CU.staggerMs;
let _lastStart = 0;

// ── Shared rAF driver ────────────────────────────────────────────────────────
// ONE requestAnimationFrame loop ticks EVERY flying icon. Previously each icon ran
// its OWN rAF loop, so a multi-stat burst spun up dozens of concurrent loops — the
// main reason the payoff crawled. Each flier is a tick(now)→done function; the loop
// PARKS itself when the list drains (no idle rAF), matching the fx-engine pattern.
const _fliers = [];
let _raf = 0;
function _pump(now) {
  for (let i = _fliers.length - 1; i >= 0; i--) {
    let done = true;
    try { done = _fliers[i](now); } catch { done = true; }
    if (done) _fliers.splice(i, 1);
  }
  _raf = _fliers.length ? requestAnimationFrame(_pump) : 0;
}
function addFlier(tick) {
  _fliers.push(tick);
  if (!_raf) _raf = requestAnimationFrame(_pump);
}

// from = { x, y } viewport coords; items = [{ emoji, statKey, amount, color }].
export function currencyBurst(from, items) {
  if (!items || !items.length) return;
  const now = performance.now();
  const start = Math.max(now, _lastStart + STAGGER_MS);
  _lastStart = start;
  const fire = () => items.forEach((it, i) => setTimeout(() => _burstOne(from, it), i * CU.itemStaggerMs));
  const wait = start - now;
  if (wait <= 0) fire();
  else setTimeout(fire, wait);
}

function targetPoint(statKey) {
  const el = document.querySelector(`[data-stat="${statKey}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
}

function pulse(el) {
  if (!el || !el.animate) return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${CU.pulseScale})` }, { transform: 'scale(1)' }],
    { duration: CU.pulseMs, easing: 'ease-out' },
  );
}

function _burstOne(from, it) {
  const tgt = targetPoint(it.statKey);
  if (!tgt) return;
  const n = clamp(Math.ceil(it.amount / CU.iconsPerAmount), CU.iconsMin, CU.iconsMax); // fewer icons — each is a DOM node on its own rAF
  // Lock the display at its current value; it will tick up as icons land.
  const currentDisplay = getDisplay(it.statKey, 0);
  startBurst(it.statKey, currentDisplay, currentDisplay + it.amount);
  const share = it.amount / n;
  for (let i = 0; i < n; i++) _icon(from, tgt, it, i, share, n);
}

function _icon(from, tgt, it, i, share, totalIcons) {
  const el = document.createElement('div');
  if (it.img) {
    const im = document.createElement('img');
    im.src = it.img;
    im.draggable = false;
    im.style.cssText = `width:${CU.iconSize}px;height:${CU.iconSize}px;object-fit:contain;display:block;`;
    el.appendChild(im);
  } else {
    el.textContent = it.emoji;
  }
  Object.assign(el.style, {
    position: 'absolute', left: '0', top: '0', fontSize: `${CU.iconFont}px`,
    willChange: 'transform, opacity',
    transform: `translate(${from.x}px,${from.y}px)`,
    // A per-icon animated drop-shadow is a GPU blur pass EVERY frame × every icon — the
    // main reason the burst crawled. A cheap static text-shadow reads the same on emoji.
    textShadow: `0 0 6px ${it.color || CU.glowColor}`,
  });
  container().appendChild(el);

  // Burst apex (a small fountain, biased upward).
  const ang = rand(0, Math.PI * 2);
  const sp = rand(...CU.burstSpeed);
  const bx = from.x + Math.cos(ang) * sp;
  const by = from.y + Math.sin(ang) * sp - CU.burstUp;
  // Arc control point (curves up into the counter).
  const cx = (bx + tgt.x) / 2 + rand(-CU.ctrlJitter, CU.ctrlJitter);
  const cy = Math.min(by, tgt.y) - rand(...CU.arcApex);

  const burstMs = CU.burstMs;
  const hangMs = CU.hangMs;
  const arcMs = CU.arcMs;
  const delay = i * CU.iconDelayMs;
  const t0 = performance.now();
  const isLast = i === totalIcons - 1;

  // tick(now) → true when this icon is finished (the shared driver then drops it).
  function frame(now) {
    const t = now - t0 - delay;
    if (t < 0) return false;

    if (t < burstMs) {
      const k = t / burstMs;
      const x = from.x + (bx - from.x) * easeOutCubic(k);
      const y = from.y + (by - from.y) * easeOutCubic(k);
      el.style.transform = `translate(${x}px,${y}px) scale(${0.4 + 0.9 * easeOutBack(Math.min(1, k))})`;
      return false;
    }
    if (t < burstMs + hangMs) {
      el.style.transform = `translate(${bx}px,${by}px) scale(1.3)`;
      return false;
    }
    const at = (t - burstMs - hangMs) / arcMs;
    if (at >= 1) {
      el.style.transform = `translate(${tgt.x}px,${tgt.y}px) scale(0.4)`;
      el.style.opacity = '0';
      pulse(tgt.el);
      // Increment the display by this icon's share; last icon snaps to exact target.
      if (isLast) finishBurst(it.statKey);
      else incrementDisplay(it.statKey, share);
      setTimeout(() => el.remove(), CU.removeMs);
      return true;
    }
    const e = easeInQuad(at);
    const x = bezier2(e, bx, cx, tgt.x);
    const y = bezier2(e, by, cy, tgt.y);
    el.style.transform = `translate(${x}px,${y}px) scale(${1.3 - 0.9 * e})`;
    return false;
  }
  addFlier(frame);

  // DOM-leak reaper (matches FrogGame's hard max-life).
  setTimeout(() => el.parentNode && el.remove(), CU.reaperMs);
}

// Throw a chest from `from` → `to` (viewport coords) with a small arc + spin.
export function throwChest(from, to, { img = null, emoji = '🧰', onLand } = {}) {
  const el = document.createElement('div');
  const half = CU.throwSize / 2;
  Object.assign(el.style, {
    position: 'absolute', left: '0', top: '0', width: `${CU.throwSize}px`, height: `${CU.throwSize}px`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${CU.throwFont}px`,
    willChange: 'transform', transform: `translate(${from.x - half}px,${from.y - half}px)`,
    filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.55))', zIndex: 10000, pointerEvents: 'none',
  });
  if (img) {
    const im = document.createElement('img');
    im.src = img;
    im.draggable = false;
    im.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    el.appendChild(im);
  } else {
    el.textContent = emoji;
  }
  container().appendChild(el);
  const cx = (from.x + to.x) / 2;
  const cy = Math.min(from.y, to.y) - CU.throwApex; // arc apex above both points
  const dur = CU.throwMs;
  const t0 = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    const x = bezier2(t, from.x, cx, to.x);
    const y = bezier2(t, from.y, cy, to.y);
    el.style.transform = `translate(${x - half}px,${y - half}px) rotate(${t * 220}deg) scale(${1 + 0.3 * Math.sin(Math.PI * t)})`;
    if (t < 1) requestAnimationFrame(frame);
    else {
      el.remove();
      if (onLand) onLand();
    }
  }
  requestAnimationFrame(frame);
  setTimeout(() => el.parentNode && el.remove(), CU.reaperMs);
}

// A "spend" explosion at a point: emoji fountain outward + up, gravity, fade.
// Unlike currencyBurst (which arcs INTO the HUD counter to read as a GAIN), this
// bursts in place to read as SPENDING soft currency on a button.
export function spendBurst(from, { emoji = '🪙', img = null, color = CU.spend.color } = {}, count = CU.spend.count) {
  for (let i = 0; i < count; i++) _spendIcon(from, { emoji, img, color });
}

function _spendIcon(from, it) {
  const el = document.createElement('div');
  if (it.img) {
    const im = document.createElement('img');
    im.src = it.img;
    im.draggable = false;
    im.style.cssText = 'width:22px;height:22px;object-fit:contain;display:block;';
    el.appendChild(im);
  } else {
    el.textContent = it.emoji;
  }
  Object.assign(el.style, {
    position: 'absolute', left: '0', top: '0', fontSize: `${CU.spend.font}px`, willChange: 'transform, opacity',
    transform: `translate(${from.x}px,${from.y}px)`, filter: `drop-shadow(0 0 5px ${it.color})`,
  });
  container().appendChild(el);
  const ang = rand(...CU.spend.fan); // fan upward
  const sp = rand(...CU.spend.speed);
  const vx = Math.cos(ang) * sp;
  const vy = Math.sin(ang) * sp;
  const g = CU.spend.grav;
  const dur = rand(...CU.spend.durMs);
  const rot = rand(-CU.spend.rot, CU.spend.rot);
  const t0 = performance.now();
  function frame(now) {
    const p = (now - t0) / dur;
    if (p >= 1) { el.remove(); return true; }
    const t = (now - t0) / 1000;
    const x = from.x + vx * t;
    const y = from.y + vy * t + 0.5 * g * t * t;
    el.style.transform = `translate(${x}px,${y}px) rotate(${rot * p}deg) scale(${1 - 0.3 * p})`;
    el.style.opacity = String(1 - p);
    return false;
  }
  addFlier(frame);
  setTimeout(() => el.parentNode && el.remove(), CU.spend.reaperMs);
}
