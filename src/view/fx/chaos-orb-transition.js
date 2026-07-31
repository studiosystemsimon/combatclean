// ─────────────────────────────────────────────────────────────────────────────
// CHAOS-ORB TRANSITION (view layer). A self-contained full-screen cinematic — a peer of
// chest-smash.js / reveal-engine.js / intro-director.js. Plays when two SPECIAL orbs merge:
// two orbs rush together → a giant legendary chaos orb GROWS + RATTLES → a POP fires a fast
// radial burst → the live screen shatters into Voronoi slabs that tumble into the void,
// revealing the (now-mounted) minigame behind the overlay.
//
// Control flow mirrors intro-director.runIntro: play to the POP apex, hand off (onApex →
// the caller launches the minigame under the opaque cover), finish the crumble reveal, onDone.
//
// ALL tuning is data (VFX_CONFIG.transition ← _vfx.json). Shared primitives come from fx-math.js;
// only the ribbon-step + Voronoi-shard geometry (which the shared fx-engine doesn't expose) live here.
// The shatter texture is a live screenshot captured via html2canvas (lazy dynamic import — falls back
// to an opaque tinted cover if unavailable), with the combat <canvas> composited on top for fidelity.
// ─────────────────────────────────────────────────────────────────────────────
import { VFX_CONFIG } from '../../data/config.js';
import { resolve } from '../assets.js';
import { clamp, rand, lerp, easeInCubic, easeOutQuad, easeOutCubic, easeOutBack, bezier2, hexToRgb, bakeGlow } from './fx-math.js';

// Growth-ease lookup (config `growEase` is a name string, like limitCharge.accel).
const EASINGS = {
  linear: (t) => t,
  easeInCubic, easeOutQuad, easeOutCubic,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

// Positioned-stop ramp sampler ({p,c}[] sorted by p) → {r,g,b}. (Not in fx-math — trail-ribbon specific.)
function rampAt(stops, t) {
  t = clamp(t, 0, 1);
  const n = stops.length;
  if (t <= stops[0].p) return hexToRgb(stops[0].c);
  if (t >= stops[n - 1].p) return hexToRgb(stops[n - 1].c);
  for (let i = 0; i < n - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.p && t <= b.p) {
      const k = (t - a.p) / ((b.p - a.p) || 1), A = hexToRgb(a.c), B = hexToRgb(b.c);
      return { r: Math.round(lerp(A.r, B.r, k)), g: Math.round(lerp(A.g, B.g, k)), b: Math.round(lerp(A.b, B.b, k)) };
    }
  }
  return hexToRgb(stops[n - 1].c);
}

// Grab the live combat canvas (drawn separately since html2canvas can't reliably rasterize a live canvas).
const combatCanvas = () => document.querySelector('.combat-panel canvas');
const rgba = (hex, a) => { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };

// Capture the live game (.app) to an offscreen canvas, compositing the combat <canvas> on top.
// Returns a canvas sized appW*scale × appH*scale, or null on any failure (→ caller uses a solid cover).
async function captureScreen(appRect, scale) {
  try {
    const app = document.querySelector('.app');
    if (!app) return null;
    const { default: html2canvas } = await import('html2canvas');
    const tex = await html2canvas(app, {
      backgroundColor: null, scale, logging: false,
      ignoreElements: (el) => el.classList && el.classList.contains('screen-transition'),
    });
    const cc = combatCanvas();
    if (cc) {
      const r = cc.getBoundingClientRect();
      const g = tex.getContext('2d');
      try { g.drawImage(cc, (r.left - appRect.left) * scale, (r.top - appRect.top) * scale, r.width * scale, r.height * scale); } catch { /* tainted/absent — skip */ }
    }
    return tex;
  } catch { return null; } // html2canvas missing or threw → graceful fallback
}

// Play the transition on `canvas` (a viewport-covering, top-z overlay owned by <ScreenTransition>).
// opts.onApex() fires at the POP (launch the minigame here). opts.onDone() fires when fully finished.
// Returns { cancel } — cancel() kills the rAF + timers immediately (unmount / re-trigger safety).
export function playChaosOrbTransition(canvas, { onApex, onDone } = {}) {
  const cfg = VFX_CONFIG.transition;               // snapshot tunables for this run (HMR applies next run)
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(VFX_CONFIG.engine.dprMax || 2, window.devicePixelRatio || 1);
  const app = document.querySelector('.app');
  const appRect = app ? app.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const W = appRect.width, H = appRect.height;
  const CX = W / 2, CY = H / 2;                     // v1: charge at the screen centre

  // Size the overlay to the viewport; work in .app-local CSS px (origin at appRect top-left).
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  const setXform = () => ctx.setTransform(dpr, 0, 0, dpr, appRect.left * dpr, appRect.top * dpr);

  // Orb art (sanctioned resolver → baked URL; fall back to a procedural orb if missing).
  const orbImg = new Image();
  let orbReady = false;
  const orbUrl = resolve('special.0').img;
  if (orbUrl) { orbImg.onload = () => { orbReady = true; }; orbImg.src = orbUrl; }

  // Screenshot texture (async); ready before the POP given the ~2s charge.
  let tex = null;
  captureScreen(appRect, dpr).then((t) => { if (!killed) tex = t; });

  // ── glow ──
  const glowCache = {};
  const stampGlow = (x, y, size, hex, alpha = 1) => {
    const s = glowCache[hex] || (glowCache[hex] = bakeGlow(hex, 1));
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(s, x - size, y - size, size * 2, size * 2);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // ── ribbon trails (blue→purple lash/suction + gold→magenta POP) ──
  const projectiles = [], impacts = [], sparks = [];
  const SPINE_N = 90, MIN_SPACING = 2.0, MAX_AGE = 0.85, LEN_REF = 26;
  function spawnTrail(from, to, o) {
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1;
    const po = o.popOut, baseAng = Math.atan2(dy, dx), sign = Math.random() < 0.5 ? -1 : 1;
    const off = (po.angleMin + Math.random() * (po.angleMax - po.angleMin)) * Math.PI / 180 * sign;
    const cpAng = baseAng + off, cpDist = po.dist * rand(0.8, 1.2);
    projectiles.push({
      x: from.x, y: from.y, from, cp: { x: from.x + Math.cos(cpAng) * cpDist, y: from.y + Math.sin(cpAng) * cpDist }, to,
      t: 0, dur: dist / o.speed, u: 0, s: 0, fired: false, r: o.r, head: o.head, ramp: o.ramp, halfW: o.width, fadeT: 0,
      headMul: 2, tailMul: 0.12, fadePow: 2, fadePeak: 1, accel: o.accel, headCfg: { rMul: 2.4, pulseAmp: 0.3, pulseFreq: 2, growTo: 2.4 },
      start: o.start || { clearDist: 0, scale: 1, alpha: 1 }, offKill: !!o.offscreenKill,
      maxAge: MAX_AGE * ((o.length || 22) / LEN_REF), spine: [], lastX: null, lastY: null, onHit: o.onHit,
    });
  }
  function stepFx(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (!p.fired) {
        p.t += dt; p.u = Math.min(1, p.t / p.dur); p.s = p.accel(p.u);
        p.x = bezier2(p.s, p.from.x, p.cp.x, p.to.x); p.y = bezier2(p.s, p.from.y, p.cp.y, p.to.y);
        if (p.offKill && (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60)) p.fired = true;
      }
      for (const sp of p.spine) sp.age += dt;
      while (p.spine.length && p.spine[0].age > p.maxAge) p.spine.shift();
      if (!p.fired && (p.lastX === null || p.u >= 1 || (p.x - p.lastX) ** 2 + (p.y - p.lastY) ** 2 > MIN_SPACING ** 2)) {
        p.spine.push({ x: p.x, y: p.y, age: 0 }); if (p.spine.length > SPINE_N) p.spine.shift(); p.lastX = p.x; p.lastY = p.y;
      }
      if (p.fired) p.fadeT += dt;
      const stC = p.start, sk0 = stC.clearDist > 0 ? Math.min(1, Math.hypot(p.x - p.from.x, p.y - p.from.y) / stC.clearDist) : 1, sk = sk0 * sk0;
      const sizeMul = stC.scale + (1 - stC.scale) * sk, alphaMul = stC.alpha + (1 - stC.alpha) * sk;
      const pts = p.spine, n = pts.length;
      if (n >= 2) {
        const nrm = [];
        for (let k = 0; k < n; k++) { const pr = pts[Math.max(0, k - 1)], nx = pts[Math.min(n - 1, k + 1)]; let ddx = nx.x - pr.x, ddy = nx.y - pr.y; const dl = Math.hypot(ddx, ddy) || 1; nrm.push({ x: -ddy / dl, y: ddx / dl }); }
        const gF = p.fired ? Math.max(0, 1 - p.fadeT / p.maxAge) : 1;
        const tpos = (k) => (n - 1 - k) / (n - 1);
        const oX = (k) => (k === n - 1 ? 1 : nrm[k].x), oY = (k) => (k === n - 1 ? 0 : nrm[k].y);
        const hwAt = (k) => p.halfW * gF * sizeMul * lerp(p.headMul, p.tailMul, tpos(k));
        for (let k = 1; k < n; k++) {                    // SOLID per-quad (gradient runs ALONG the length, never across width)
          const a = pts[k - 1], b = pts[k], hwa = hwAt(k - 1), hwb = hwAt(k);
          const tm = (tpos(k - 1) + tpos(k)) * 0.5, c = rampAt(p.ramp, tm);
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${(p.fadePeak * Math.pow(1 - tm, p.fadePow) * gF * alphaMul).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x + oX(k - 1) * hwa, a.y + oY(k - 1) * hwa); ctx.lineTo(b.x + oX(k) * hwb, b.y + oY(k) * hwb);
          ctx.lineTo(b.x - oX(k) * hwb, b.y - oY(k) * hwb); ctx.lineTo(a.x - oX(k - 1) * hwa, a.y - oY(k - 1) * hwa);
          ctx.closePath(); ctx.fill();
        }
      }
      if (!p.fired) {                                    // glowing WHITE head (coloured glow + white glow + white core)
        const hc = p.headCfg, grow = 1 + (hc.growTo - 1) * p.s, pulse = 1 + hc.pulseAmp * Math.sin(p.u * hc.pulseFreq * Math.PI * 2);
        const headR = p.r * hc.rMul * grow * pulse * sizeMul;
        stampGlow(p.x, p.y, headR * 2.4, p.head, 0.9 * alphaMul);
        stampGlow(p.x, p.y, headR * 1.1, '#ffffff', 0.55 * alphaMul);
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.9 * alphaMul;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, headR * 0.42), 0, 7); ctx.fill();
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        if (p.u >= 1) { p.fired = true; if (p.onHit) p.onHit(); }
      } else if (n === 0) { projectiles.splice(i, 1); }
    }
    for (let i = impacts.length - 1; i >= 0; i--) {
      const im = impacts[i]; im.t += dt; if (im.t < 0) continue; const q = Math.min(1, im.t / im.dur);
      if (im.kind === 'disc') { stampGlow(im.x, im.y, im.r0 + (im.r1 - im.r0) * (1 - Math.pow(1 - q, 3)), im.color, 0.9 * (1 - q)); }
      else { const rad = im.r0 + (im.r1 - im.r0) * (q >= 1 ? 1 : 1 - Math.pow(2, -10 * q)); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - q) * 0.9; ctx.strokeStyle = im.color; ctx.lineWidth = im.w * (1 - q * 0.7); ctx.beginPath(); ctx.arc(im.x, im.y, rad, 0, 7); ctx.stroke(); ctx.restore(); }
      if (q >= 1) impacts.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t += dt; const k = s.t / s.life; if (k >= 1) { sparks.splice(i, 1); continue; }
      const vel = Math.cos(k * Math.PI / 2); s.x += s.vx * vel * dt; s.y += s.vy * vel * dt; const al = 1 - k;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al; ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.6 + 0.4 * al), 0, 7); ctx.fill(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  const fxImpact = (x, y, { color = '#fff', r = 8, heavy = false } = {}) => {
    impacts.push({ kind: 'disc', x, y, t: 0, dur: 0.24, r0: r * 0.3, r1: r * (heavy ? 2.2 : 1.6), color });
    impacts.push({ kind: 'ring', x, y, t: 0, dur: 0.34, r0: r, r1: r * (heavy ? 3 : 2.2), w: heavy ? 3 : 2, color });
  };

  // ── emission / suction / POP ──
  let orbBoost = 0;
  const onSuckHit = () => { orbBoost = Math.min(1, orbBoost + 0.12); };
  function spawnEmitTrail() {
    const a = Math.random() * 6.28, D = cfg.offBig * rand(0.9, 1.3);
    spawnTrail({ x: CX + rand(-6, 6), y: CY + rand(-6, 6) }, { x: CX + Math.cos(a) * D, y: CY + Math.sin(a) * D },
      { ramp: cfg.lashRamp, head: cfg.lashRamp[0].c, width: cfg.trailW, length: cfg.trailLen, speed: cfg.emitSpeed * rand(0.8, 1.35), r: cfg.headR, popOut: { dist: rand(90, 230), angleMin: 30, angleMax: 140 }, accel: easeOutQuad, offscreenKill: true });
  }
  function spawnSuckTrail() {
    const a = Math.random() * 6.28, r = cfg.ringR * rand(0.82, 1.15), jit = cfg.bigR * 0.5;
    spawnTrail({ x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r * 0.9 }, { x: CX + rand(-jit, jit), y: CY + rand(-jit, jit) },
      { ramp: cfg.lashRamp, head: cfg.lashRamp[0].c, width: cfg.trailW, length: cfg.trailLen, speed: cfg.suckSpeed * rand(0.85, 1.15), r: cfg.headR, popOut: { dist: rand(50, 120), angleMin: 40, angleMax: 120 }, accel: easeInCubic, start: { clearDist: 80, scale: 0.08, alpha: 0.12 }, onHit: onSuckHit });
  }
  function popBurst() {
    for (let i = 0; i < cfg.popBurst; i++) {
      const a = i / cfg.popBurst * 6.28 + rand(-0.15, 0.15), D = cfg.offBig * rand(0.9, 1.3);
      spawnTrail({ x: CX + rand(-4, 4), y: CY + rand(-4, 4) }, { x: CX + Math.cos(a) * D, y: CY + Math.sin(a) * D },
        { ramp: cfg.popRamp, head: cfg.popRamp[0].c, width: cfg.trailW * 1.2, length: cfg.trailLen * 0.8, speed: cfg.popSpeed * rand(0.9, 1.25), r: cfg.headR * 1.1, popOut: { dist: rand(30, 120), angleMin: 10, angleMax: 60 }, accel: easeOutQuad, offscreenKill: true });
    }
  }
  let emitAcc = 0, nextGap = cfg.gapMin;
  function runEmitter(chargeT, dt) {
    if (chargeT > cfg.emitWindow) return;
    emitAcc += dt;
    if (emitAcc >= nextGap) {
      emitAcc = 0;
      for (let k = 0; k < cfg.emitPerTick; k++) spawnEmitTrail();
      for (let k = 0; k < cfg.suckPerTick; k++) spawnSuckTrail();
      const f = Math.min(1, chargeT / cfg.emitWindow);
      nextGap = cfg.gapMin + (cfg.gapMax - cfg.gapMin) * (f * f);
    }
  }

  // ── orb ──
  const growEase = EASINGS[cfg.growEase] || easeOutCubic;
  function drawRushOrbs(u) {
    const e = u * u, r = Math.min(W, H) * 0.06;
    const [ax, ay] = [CX - r * 2.2, CY], [bx, by] = [CX + r * 2.2, CY];
    for (const [sx, sy] of [[ax, ay], [bx, by]]) {
      const x = sx + (CX - sx) * e, y = sy + (CY - sy) * e;
      stampGlow(x, y, r * 1.7, cfg.orbGlow, 0.55 * u);
      if (orbReady) ctx.drawImage(orbImg, x - r, y - r, r * 2, r * 2);
      else { const gd = ctx.createRadialGradient(x, y, r * 0.2, x, y, r); gd.addColorStop(0, '#eaf4ff'); gd.addColorStop(0.5, '#6a6cff'); gd.addColorStop(1, '#2a0b4e'); ctx.fillStyle = gd; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
    }
  }
  function drawBigOrb(chargeT, dt) {
    const gp = Math.min(1, chargeT / cfg.growT), s = growEase(gp);
    const strain = gp > 0.6 ? ((gp - 0.6) / 0.4) * 0.05 * Math.sin(chargeT * 34) : 0;
    const pulse = 1 + 0.02 * Math.sin(chargeT * 9) + orbBoost * 0.06 + strain;
    const rattle = cfg.rattleMax * gp * gp, jx = rand(-rattle, rattle), jy = rand(-rattle, rattle);
    const R = cfg.bigR * s * pulse, cx = CX + jx, cy = CY + jy, app = Math.min(1, gp * 4);
    stampGlow(cx, cy, R * 2.3, cfg.orbGlow, (0.45 + orbBoost * 0.4) * app);
    stampGlow(cx, cy, R * 1.35, cfg.orbGlow2, (0.3 + orbBoost * 0.3) * app);
    ctx.save(); ctx.filter = `brightness(${(1 + orbBoost * 0.8).toFixed(2)})`;
    if (orbReady) ctx.drawImage(orbImg, cx - R, cy - R, R * 2, R * 2);
    else { const gd = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R); gd.addColorStop(0, '#eaf4ff'); gd.addColorStop(0.5, '#6a6cff'); gd.addColorStop(1, '#2a0b4e'); ctx.fillStyle = gd; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); }
    ctx.restore();
    orbBoost = Math.max(0, orbBoost - dt * 2.2);
  }

  // ── Voronoi shards ──
  let shards = [], maxR = 1;
  function clipHP(poly, mx, my, nx, ny) {
    const out = [], N = poly.length;
    for (let i = 0; i < N; i++) {
      const A = poly[i], B = poly[(i + 1) % N], da = (A.x - mx) * nx + (A.y - my) * ny, db = (B.x - mx) * nx + (B.y - my) * ny;
      if (da >= 0) out.push(A);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push({ x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) }); }
    }
    return out;
  }
  function buildShards() {
    shards = []; maxR = 1; const seeds = [], spread = Math.hypot(W, H) * 0.6, N = cfg.shardCount;
    for (let i = 0; i < N; i++) { let x, y; if (Math.random() < 0.64) { const a = Math.random() * 7, r = Math.pow(Math.random(), 1.7) * spread; x = CX + Math.cos(a) * r; y = CY + Math.sin(a) * r; } else { x = Math.random() * W; y = Math.random() * H; } seeds.push({ x, y }); }
    const rect = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
    for (let i = 0; i < seeds.length; i++) {
      let poly = rect;
      for (let j = 0; j < seeds.length; j++) { if (i === j) continue; poly = clipHP(poly, (seeds[i].x + seeds[j].x) / 2, (seeds[i].y + seeds[j].y) / 2, seeds[i].x - seeds[j].x, seeds[i].y - seeds[j].y); if (poly.length < 3) break; }
      if (poly.length < 3) continue;
      let cx = 0, cy = 0; for (const p of poly) { cx += p.x; cy += p.y; } cx /= poly.length; cy /= poly.length;
      const dj = Math.max(0, Math.hypot(cx - CX, cy - CY) + (Math.random() - 0.5) * 38);
      shards.push({ poly, cx, cy, dj, det: false, dx: 0, dy: 0, rot: 0, vr: 0, a: 1, vx: 0, vy: 0 });
      if (dj > maxR) maxR = dj;
    }
  }
  function detach(s) { s.det = true; const a = Math.atan2(s.cy - CY, s.cx - CX), spd = 0.05 + Math.random() * 0.13; s.vx = Math.cos(a) * spd * (0.4 + Math.random() * 0.7); s.vy = Math.sin(a) * spd * 0.32 - (0.015 + Math.random() * 0.05); s.vr = (Math.random() - 0.5) * 0.02; }
  function drawCover() { if (tex) ctx.drawImage(tex, 0, 0, W, H); else { ctx.fillStyle = rgba(cfg.orbGlow, 0.92); ctx.fillRect(0, 0, W, H); } }
  function crumble(R, dtMs, shake) {
    const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;
    ctx.save(); ctx.translate(shx, shy);
    drawCover();                                                   // intact screen (or fallback cover)
    for (const s of shards) { const near = s.dj - R; if (!s.det && near > 0 && near < 44) { ctx.beginPath(); ctx.moveTo(s.poly[0].x, s.poly[0].y); for (let i = 1; i < s.poly.length; i++) ctx.lineTo(s.poly[i].x, s.poly[i].y); ctx.closePath(); ctx.strokeStyle = rgba(cfg.holeColorA, (1 - near / 44) * 0.5); ctx.lineWidth = 1.2; ctx.stroke(); } }
    ctx.globalCompositeOperation = 'destination-out';             // punch holes → transparent → minigame shows through
    for (const s of shards) { if (s.det) { ctx.beginPath(); ctx.moveTo(s.poly[0].x, s.poly[0].y); for (let i = 1; i < s.poly.length; i++) ctx.lineTo(s.poly[i].x, s.poly[i].y); ctx.closePath(); ctx.fill(); } }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of shards) {                                     // flying slabs (clipped texture) + white bottom-right bevel
      if (s.det && s.a > 0) {
        ctx.save(); ctx.globalAlpha = Math.max(0, s.a); ctx.translate(s.cx + s.dx, s.cy + s.dy); ctx.rotate(s.rot);
        ctx.save(); ctx.beginPath(); ctx.moveTo(s.poly[0].x - s.cx, s.poly[0].y - s.cy); for (let i = 1; i < s.poly.length; i++) ctx.lineTo(s.poly[i].x - s.cx, s.poly[i].y - s.cy); ctx.closePath(); ctx.clip();
        if (tex) ctx.drawImage(tex, -s.cx, -s.cy, W, H); else { ctx.fillStyle = rgba(cfg.orbGlow, 0.92); ctx.fillRect(-s.cx, -s.cy, W, H); }
        ctx.fillStyle = `rgba(0,0,0,${(1 - s.a) * 0.8})`; ctx.fill(); ctx.restore();
        if (cfg.edge3d > 0) {
          const P = s.poly, ctr = Math.cos(s.rot), str = Math.sin(s.rot);
          ctx.strokeStyle = `rgba(255,255,255,${cfg.edge3d})`; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
          for (let i = 0; i < P.length; i++) { const A = P[i], B = P[(i + 1) % P.length]; const ax = A.x - s.cx, ay = A.y - s.cy, bx = B.x - s.cx, by = B.y - s.cy; let nx = by - ay, ny = -(bx - ax); const mx = (ax + bx) / 2, my = (ay + by) / 2; if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; } const sx = nx * ctr - ny * str, sy = nx * str + ny * ctr; if (sx + sy > 0) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); } }
        }
        ctx.restore();
      }
    }
    if (R > 0 && R < maxR) { const ring = ctx.createRadialGradient(CX, CY, Math.max(0, R - 34), CX, CY, R + 20); ring.addColorStop(0, 'rgba(0,0,0,0)'); ring.addColorStop(0.72, 'rgba(0,0,0,0)'); ring.addColorStop(0.86, rgba(cfg.holeColorA, 0.55)); ring.addColorStop(0.94, rgba(cfg.holeColorB, 0.6)); ring.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = ring; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    ctx.restore();
  }

  // ── timeline ──
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 2.2));
  let killed = false, raf = null, phase = 'merge', mT0 = 0, mLast = 0, t0 = 0, last = 0, collided = false, collideFlash = 0, apexFired = false;

  function onCollision() {
    fxImpact(CX, CY, { color: cfg.collideColor, r: 44, heavy: true });
    fxImpact(CX, CY, { color: cfg.orbGlow, r: 74, heavy: true });
    impacts.push({ kind: 'ring', x: CX, y: CY, t: 0, dur: 0.5, r0: 20, r1: 270, w: 5, color: cfg.shockColor });
    for (let i = 0; i < 20; i++) { const a = i / 20 * 6.28 + rand(-0.3, 0.3), sp = rand(120, 300); sparks.push({ x: CX, y: CY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: rand(0.4, 0.75), size: rand(2, 4), color: i % 2 ? cfg.sparkColorA : cfg.sparkColorB }); }
  }

  // Clear the WHOLE backing store in device space (no offset/smear), then re-apply the .app-local transform.
  function drawClear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); setXform(); }
  function frame(ts) {
    if (killed) return;
    try {
      if (phase === 'merge') {
        const dt = Math.min(0.04, (ts - mLast) / 1000); mLast = ts;
        const el = (ts - mT0) / 1000, RUSH = cfg.rushT, TOTAL = RUSH + cfg.growT, chargeT = Math.max(0, el - RUSH);
        drawClear();                                                 // transparent → live game shows through
        let amp = 0; if (el >= RUSH) amp = 1.2 + Math.min(6, chargeT * 2.2); if (collideFlash > 0) { amp += collideFlash * 8; collideFlash = Math.max(0, collideFlash - dt * 3); }
        const shx = rand(-amp, amp), shy = rand(-amp, amp);
        if (el < RUSH) { ctx.save(); ctx.translate(shx, shy); drawRushOrbs(el / RUSH); ctx.restore(); }
        else {
          if (!collided) { collided = true; collideFlash = 1; onCollision(); }
          runEmitter(chargeT, dt);
          stepFx(dt);                                                // trails/impacts/sparks — STABLE screen space (NOT coupled to the orb's shake)
          ctx.save(); ctx.translate(shx, shy); drawBigOrb(chargeT, dt); ctx.restore(); // only the orb rattles
        }
        if (el >= TOTAL) {                                           // POP → hand off (launch minigame under the cover), then ignite→crumble
          fxImpact(CX, CY, { color: cfg.igniteColor, r: 64, heavy: true }); fxImpact(CX, CY, { color: cfg.orbGlow, r: 120, heavy: true });
          popBurst(); buildShards();
          if (!apexFired) { apexFired = true; try { onApex && onApex(); } catch { /* caller error must not strand the run */ } }
          phase = 'ignite'; t0 = ts; last = ts;
        }
        raf = requestAnimationFrame(frame); return;
      }
      if (phase === 'ignite') {                                      // collapse-lead flash over the opaque cover (igniteMs/igniteColor)
        const dtMs = Math.min(40, ts - last); last = ts;
        const p = cfg.igniteMs > 0 ? clamp((ts - t0) / cfg.igniteMs, 0, 1) : 1;
        drawClear(); drawCover();
        ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba(cfg.igniteColor, 0.9 * p); ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
        stepFx(dtMs / 1000);
        if (p >= 1) { phase = 'crumble'; t0 = ts; last = ts; }
        raf = requestAnimationFrame(frame); return;
      }
      // crumble
      const dtMs = Math.min(40, ts - last); last = ts; const dtS = dtMs / 1000;
      const prog = (ts - t0) / cfg.crumbleMs, R = ease(prog) * maxR * 1.03, shake = cfg.crumbleShake * (1 - Math.min(1, prog));
      for (const s of shards) { if (!s.det && R >= s.dj) detach(s); if (s.det) { s.vy += 0.00022 * dtMs; s.dx += s.vx * dtMs; s.dy += s.vy * dtMs; s.rot += s.vr * dtMs; s.a -= 0.0016 * dtMs; } }
      drawClear();
      crumble(R, dtMs, shake);
      stepFx(dtS);                                                   // POP burst finishes flying over the shatter
      if (prog >= 1 + cfg.crumbleTail) { finish(); return; }
      raf = requestAnimationFrame(frame);
    } catch { finish(); }                                            // any draw error → tear down + onDone (never strand the input-locking overlay)
  }

  function finish() {
    if (killed) return; killed = true;
    if (raf) cancelAnimationFrame(raf); raf = null;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    try { onDone && onDone(); } catch { /* noop */ }
  }

  mT0 = performance.now(); mLast = mT0;
  raf = requestAnimationFrame(frame);

  return {
    cancel() {
      if (killed) return; killed = true;
      if (raf) cancelAnimationFrame(raf); raf = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
