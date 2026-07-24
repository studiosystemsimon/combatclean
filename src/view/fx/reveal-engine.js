// === reveal-engine.js — self-contained chest/gacha reveal cinematic ===
//
// Ported VERBATIM (structure + behaviour + load-bearing constants) from
// FrogGame's src/ui/screens/gacha-reveal-engine.js. The source is a
// framework-agnostic Canvas2D reveal engine with ZERO imports (pure DOM +
// performance.now + ResizeObserver + Canvas2D) — so it drops into MergeCombat
// with no FrogGame coupling. See docs/froggame-vfx-port.md §4.
//
// The engine owns the 6-beat choreography (anticipation → build-up → rarity
// tell → climax → hero reveal → afterglow), the per-tier escalation tables,
// the pooled particle system (MAX_P cap), the tween engine, the single RAF,
// screen shake / flash / chroma, god-rays / halo / orb / lens, expanding
// rings, and dispose() hygiene. The HOST owns the revealed content (the chest
// reward) and drives it via injected hooks (onFrogReveal / setShake /
// setChroma / onAfterglowDone / sound).
//
// `playChestReveal(containerEl, { rarity, rewardEmoji, rewardName }, onDone)`
// (bottom of file) wires those hooks to a centered DOM reward element.
//
// Lifecycle: new GachaRevealEngine(container, opts) mounts 3 canvases + a
// flash/tint overlay into `container`; .play(pull, {...}) runs a reveal;
// .skip() jumps to the end; .dispose() cancels the RAF and removes the DOM.
// Exactly one internal RAF, capped particle pool (MAX_P=900), no leaks.

// ---- rarity theme (mirrors src/data/rarities.js HERO_RARITIES + mockup RARITY) ----
// Hero rarity ladder: common(0)…primal(5). `col`/`tier`/`pips`/`prismatic` mirror
// HERO_RARITIES; `disp`/`glowR`/`ms` are VFX-only fields the engine escalates on.
// 6 entries so the LAD[tier] escalation arrays (length 6) line up. The chest
// wrapper maps gear common/rare/epic/legendary → these same keys (legendary→tier 3).
const RARITY = {
  common:   { id: 'common',    disp: 'COMMON',    col: '#9aa7bd', glowR: 0,  ms: 320,  tier: 0, pips: 1 },
  rare:     { id: 'rare',      disp: 'RARE',      col: '#4aa3ff', glowR: 8,  ms: 900,  tier: 1, pips: 2 },
  epic:     { id: 'epic',      disp: 'EPIC',      col: '#b46bff', glowR: 13, ms: 1600, tier: 2, pips: 3 },
  legendary:{ id: 'legendary', disp: 'LEGENDARY', col: '#ffb020', glowR: 17, ms: 2500, tier: 3, pips: 4 },
  mythic:   { id: 'mythic',    disp: 'MYTHIC',    col: '#ff2e6e', glowR: 24, ms: 3200, tier: 4, pips: 5 },
  primal:   { id: 'primal',    disp: 'PRIMAL',    col: '#78f0ff', glowR: 32, ms: 4000, tier: 5, pips: 6, prismatic: true },
};
const R_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'primal'];

// per-tier escalation ladders (indexed common→PRIMAL, 0-5) — ported from the mockup.
const LAD = {
  flash:    [0.12, 0.55, 0.78, 0.95, 1.0, 1.0],
  rings:    [1, 3, 5, 7, 9, 12],
  burst:    [45, 130, 190, 260, 360, 480],
  shake:    [2, 5, 7, 10, 14, 18],
  shakeRot: [0, 0, 0.15, 0.3, 0.55, 0.8],
  chroma:   [0, 2, 5, 9, 12, 16],
  confetti: [0, 24, 48, 80, 120, 170],
  rays:     [5, 6, 7, 9, 11, 14],
  slowmo:   [1, 1, 1, 0.4, 0.26, 0.2],
};

export function rarityMeta(id) { return RARITY[id] || RARITY.common; }

// a random vivid rainbow rgb — the PRISMATIC (primal) tier cycles through it.
function prismCol() {
  const h = Math.random() * 360, c = 1, x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  return [((r * 0.6 + 0.4) * 255) | 0, ((g * 0.6 + 0.4) * 255) | 0, ((b * 0.6 + 0.4) * 255) | 0];
}

// ---- easing (verbatim from mockup) ----
const E = {
  linear: t => t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inQuad: t => t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outQuart: t => 1 - Math.pow(1 - t, 4),
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t, s = 1.70158) => { const c3 = s + 1; return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
  outElastic: t => { const c4 = (2 * Math.PI) / 3; return t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; },
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
function hexRGB(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }

const MAX_P = 900;

export class GachaRevealEngine {
  constructor(container, opts = {}) {
    this.container = container;
    // injected hooks (host owns the reward/name/pips/traits DOM + chroma filter)
    this.sound = opts.sound || (() => {});
    this.onFrogReveal = opts.onFrogReveal || (() => {});   // (tier)
    this.onNameBanner = opts.onNameBanner || (() => {});   // (tier, pull)
    this.onPip = opts.onPip || (() => {});                 // (i)
    this.onTraits = opts.onTraits || (() => {});           // (pull)
    this.onAfterglowDone = opts.onAfterglowDone || (() => {}); // ()
    this.onFakeUpgrade = opts.onFakeUpgrade || (() => {}); // (realRarityId)
    this.setChroma = opts.setChroma || (() => {});         // (px)
    this.setShake = opts.setShake || (() => {});           // (x,y,rotDeg)
    this.reducedMotion = !!opts.reducedMotion;
    this.focalPt = opts.focal || null; // {x,y} canvas coords; centers the reveal on a cell

    // ---- DOM: 3 canvases + flash + tint overlays inside container ----
    const mk = (z) => {
      const c = document.createElement('canvas');
      c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z};`;
      container.appendChild(c);
      return c;
    };
    this.fxBack = mk(2);   // orb / rays / halo (behind reward)
    this.crackC = mk(6);   // reality crack (mythic)
    this.fxFront = mk(9);  // particles / rings / lens (over reward)
    this.tint = document.createElement('div');
    this.tint.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:1;mix-blend-mode:screen;';
    container.appendChild(this.tint);
    this.flash = document.createElement('div');
    this.flash.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:11;mix-blend-mode:screen;';
    container.appendChild(this.flash);

    this.ctxB = this.fxBack.getContext('2d');
    this.ctxF = this.fxFront.getContext('2d');
    this.ctxC = this.crackC.getContext('2d');

    // ---- particle pool ----
    this.P = {
      x: new Float32Array(MAX_P), y: new Float32Array(MAX_P),
      vx: new Float32Array(MAX_P), vy: new Float32Array(MAX_P),
      life: new Float32Array(MAX_P), max: new Float32Array(MAX_P),
      size: new Float32Array(MAX_P), rot: new Float32Array(MAX_P), vr: new Float32Array(MAX_P),
      r: new Uint8Array(MAX_P), g: new Uint8Array(MAX_P), b: new Uint8Array(MAX_P),
      kind: new Uint8Array(MAX_P), drag: new Float32Array(MAX_P), grav: new Float32Array(MAX_P),
      active: new Uint8Array(MAX_P), cursor: 0,
    };
    this.rings = [];
    this.tweens = [];
    this.timers = [];
    this.afterglowIv = null;
    this.scene = {
      cx: 0, cy: 0, orb: 0, orbCol: [156, 163, 175], rays: 0, rayCol: [245, 158, 11],
      rayN: 5, rayRot: 0, halo: 0, haloCol: [255, 255, 255], swirl: 0, lens: 0,
      shakeX: 0, shakeY: 0, shakeRot: 0, chroma: 0, slow: 1,
    };
    this.shakeAmp = 0; this.shakeRotAmp = 0; this.shakeDecay = 0;
    this.W = 0; this.H = 0; this.DPR = 1;
    this.raf = null; this.last = 0;
    this.disposed = false;
    this.curReveal = null;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    // full-screen cinematic: track the CONTAINER's box via ResizeObserver so
    // the canvases + overlays follow every layout/safe-area/viewport change,
    // not only window 'resize' events.
    this._ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(container);
    }
    this._resize();
    this._start();
  }

  // ---------------------------------------------------------------- sizing
  _resize() {
    if (this.disposed) return;
    const r = this.container.getBoundingClientRect();
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width || 1; this.H = r.height || 1;
    for (const c of [this.fxBack, this.fxFront, this.crackC]) {
      c.width = Math.round(this.W * this.DPR); c.height = Math.round(this.H * this.DPR);
    }
    for (const cx of [this.ctxB, this.ctxF, this.ctxC]) cx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
  }

  focal() { return this.focalPt || { x: this.W / 2, y: this.H * 0.42 }; }

  // reduced-motion particle-count scaler (mirrors the mockup's `pcount`).
  _pc(n) { return this.reducedMotion ? Math.round(n * 0.5) : n; }

  // ---------------------------------------------------------------- pool
  _spawnP(o) {
    const P = this.P; let i = -1;
    for (let k = 0; k < MAX_P; k++) { const idx = (P.cursor + k) % MAX_P; if (!P.active[idx]) { i = idx; break; } }
    if (i < 0) return; P.cursor = (i + 1) % MAX_P;
    P.active[i] = 1;
    P.x[i] = o.x; P.y[i] = o.y; P.vx[i] = o.vx || 0; P.vy[i] = o.vy || 0;
    P.max[i] = o.life; P.life[i] = o.life; P.size[i] = o.size || 3;
    P.rot[i] = o.rot || 0; P.vr[i] = o.vr || 0;
    P.r[i] = o.r; P.g[i] = o.g; P.b[i] = o.b; P.kind[i] = o.kind || 0;
    P.drag[i] = o.drag != null ? o.drag : 1.0; P.grav[i] = o.grav || 0;
  }
  _updateP(dt) {
    const P = this.P;
    for (let i = 0; i < MAX_P; i++) {
      if (!P.active[i]) continue;
      P.life[i] -= dt; if (P.life[i] <= 0) { P.active[i] = 0; continue; }
      P.vx[i] *= (1 - P.drag[i] * dt); P.vy[i] *= (1 - P.drag[i] * dt);
      P.vy[i] += P.grav[i] * dt;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
      P.rot[i] += P.vr[i] * dt;
    }
  }
  _drawP(cx) {
    const P = this.P, DPR = this.DPR;
    cx.save();
    for (let i = 0; i < MAX_P; i++) {
      if (!P.active[i]) continue;
      const t = P.life[i] / P.max[i];
      const a = E.outQuad(clamp(t, 0, 1));
      const col = `rgba(${P.r[i]},${P.g[i]},${P.b[i]},`;
      const x = P.x[i], y = P.y[i], s = P.size[i], k = P.kind[i];
      if (k === 0) {
        cx.globalCompositeOperation = 'lighter';
        const rad = s * (0.6 + a * 0.9);
        const gr = cx.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, col + (a * 0.9) + ')'); gr.addColorStop(1, col + '0)');
        cx.fillStyle = gr; cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.fill();
      } else if (k === 1) {
        cx.globalCompositeOperation = 'lighter';
        cx.translate(x, y); cx.rotate(P.rot[i]); cx.scale(s, s);
        const gr = cx.createRadialGradient(0, 0, 0, 0, 0, 1.6);
        gr.addColorStop(0, col + a + ')'); gr.addColorStop(1, col + '0)');
        cx.fillStyle = gr; cx.beginPath();
        for (let p = 0; p < 4; p++) { const ang = p * Math.PI / 2; const lx = Math.cos(ang), ly = Math.sin(ang);
          cx.moveTo(0, 0); cx.lineTo(lx * 1.6 - ly * 0.28, ly * 1.6 + lx * 0.28);
          cx.lineTo(lx * 1.6 + ly * 0.28, ly * 1.6 - lx * 0.28); } cx.fill();
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
      } else if (k === 2) {
        cx.globalCompositeOperation = 'lighter';
        const sp = Math.hypot(P.vx[i], P.vy[i]); const ux = P.vx[i] / (sp || 1), uy = P.vy[i] / (sp || 1);
        const len = clamp(sp * 0.02, 6, 26) * (0.5 + a);
        cx.strokeStyle = col + (a * 0.85) + ')'; cx.lineWidth = s * a + 0.6; cx.lineCap = 'round';
        cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x - ux * len, y - uy * len); cx.stroke();
      } else if (k === 3) {
        cx.globalCompositeOperation = 'lighter';
        const fl = 0.6 + 0.4 * Math.sin(P.rot[i] * 20);
        cx.fillStyle = col + (a * fl) + ')'; cx.beginPath(); cx.arc(x, y, s * (0.4 + a * 0.6), 0, 7); cx.fill();
      } else if (k === 4) {
        cx.globalCompositeOperation = 'source-over';
        cx.translate(x, y); cx.rotate(P.rot[i]);
        cx.fillStyle = col + (clamp(a * 1.4, 0, 0.95)) + ')';
        const w = s * 1.1, h = s * 0.5; cx.fillRect(-w / 2, -h / 2, w, h);
        cx.setTransform(DPR, 0, 0, DPR, 0, 0);
      } else if (k === 5) {
        cx.globalCompositeOperation = 'lighter';
        cx.fillStyle = col + a + ')'; cx.beginPath(); cx.arc(x, y, s * a + 0.4, 0, 7); cx.fill();
      }
    }
    cx.restore();
    cx.globalCompositeOperation = 'source-over';
  }
  _clearParticles() { for (let i = 0; i < MAX_P; i++) this.P.active[i] = 0; }

  // ---------------------------------------------------------------- rings
  _addRing(o) { this.rings.push(Object.assign({ t: 0 }, o)); }
  _updateDrawRings(cx, dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; const p = r.t / r.dur;
      if (p >= 1) { this.rings.splice(i, 1); continue; }
      const rad = lerp(r.r0, r.r1, E.outExpo(p));
      const a = (1 - p) * r.a;
      cx.globalCompositeOperation = 'lighter';
      cx.strokeStyle = `rgba(${r.rgb[0]},${r.rgb[1]},${r.rgb[2]},${a})`;
      cx.lineWidth = r.w * (1 - p * 0.6);
      cx.beginPath(); cx.arc(r.x, r.y, rad, 0, 7); cx.stroke();
      cx.strokeStyle = `rgba(255,255,255,${a * 0.5})`; cx.lineWidth = r.w * 0.35 * (1 - p);
      cx.beginPath(); cx.arc(r.x, r.y, rad, 0, 7); cx.stroke();
    }
    cx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- god-rays / halo / orb / lens
  _drawOrb(cx) {
    const s = this.scene; if (s.orb <= 0.001) return;
    const [r, g, b] = s.orbCol, x = s.cx, y = s.cy, o = s.orb;
    cx.globalCompositeOperation = 'lighter';
    if (s.swirl > 0.001) {
      const N = 14;
      for (let i = 0; i < N; i++) {
        const ang = s.rayRot * 2 + i / N * Math.PI * 2;
        const rr = lerp(140, 26, s.swirl) + Math.sin(s.rayRot * 3 + i) * 8;
        const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
        const gr = cx.createRadialGradient(px, py, 0, px, py, 10 * o);
        gr.addColorStop(0, `rgba(${r},${g},${b},${0.5 * s.swirl})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        cx.fillStyle = gr; cx.beginPath(); cx.arc(px, py, 10 * o, 0, 7); cx.fill();
      }
    }
    const rad = lerp(8, 64, o) + Math.sin(performance.now() * 0.006) * 4 * o;
    const gr = cx.createRadialGradient(x, y, 0, x, y, rad * 2.2);
    gr.addColorStop(0, `rgba(255,255,255,${0.9 * o})`);
    gr.addColorStop(0.28, `rgba(${r},${g},${b},${0.85 * o})`);
    gr.addColorStop(0.6, `rgba(${r},${g},${b},${0.32 * o})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    cx.fillStyle = gr; cx.beginPath(); cx.arc(x, y, rad * 2.2, 0, 7); cx.fill();
    cx.globalCompositeOperation = 'source-over';
  }
  _drawRays(cx) {
    const s = this.scene; if (s.rays <= 0.001) return;
    const [r, g, b] = s.rayCol, x = s.cx, y = s.cy, o = s.rays, N = s.rayN;
    cx.save(); cx.translate(x, y); cx.rotate(s.rayRot);
    cx.globalCompositeOperation = 'lighter';
    const len = Math.max(this.W, this.H) * 1.3;
    for (let i = 0; i < N; i++) {
      cx.rotate((Math.PI * 2) / N);
      const wob = 1 + Math.sin(s.rayRot * 4 + i) * 0.25;
      const wide = lerp(10, 42, o) * wob;
      const gr = cx.createLinearGradient(0, 0, 0, -len);
      gr.addColorStop(0, `rgba(${r},${g},${b},${0.42 * o})`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      cx.fillStyle = gr; cx.beginPath();
      cx.moveTo(0, 0); cx.lineTo(-wide, -len); cx.lineTo(wide, -len); cx.closePath(); cx.fill();
    }
    cx.restore(); cx.globalCompositeOperation = 'source-over';
  }
  _drawHalo(cx) {
    const s = this.scene; if (s.halo <= 0.001) return;
    const [r, g, b] = s.haloCol, x = s.cx, y = s.cy, o = s.halo;
    cx.globalCompositeOperation = 'lighter';
    const rad = lerp(60, 150, o);
    cx.lineWidth = lerp(2, 10, o);
    cx.strokeStyle = `rgba(${r},${g},${b},${0.5 * o})`;
    cx.beginPath(); cx.arc(x, y, rad, 0, 7); cx.stroke();
    cx.globalCompositeOperation = 'source-over';
  }
  _drawLens(cx) {
    const s = this.scene; if (s.lens <= 0.001) return;
    const x = s.cx, y = s.cy - 4, o = s.lens, W = this.W, H = this.H;
    cx.globalCompositeOperation = 'lighter';
    const gr = cx.createLinearGradient(x - W * 0.7, y, x + W * 0.7, y);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.7 * o})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, y - 2.5 * o, W, 5 * o);
    const gv = cx.createLinearGradient(x, y - H * 0.7, x, y + H * 0.7);
    gv.addColorStop(0, 'rgba(255,255,255,0)'); gv.addColorStop(0.5, `rgba(255,255,255,${0.55 * o})`);
    gv.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gv; cx.fillRect(x - 2 * o, 0, 4 * o, H);
    const gc = cx.createRadialGradient(x, y, 0, x, y, 90 * o);
    gc.addColorStop(0, `rgba(255,255,255,${0.9 * o})`); gc.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gc; cx.beginPath(); cx.arc(x, y, 90 * o, 0, 7); cx.fill();
    cx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- flash / chroma / shake
  _flashScreen(peak, col, upMs, downMs) {
    if (this.reducedMotion) peak *= 0.5;
    this.flash.style.background = col
      ? `radial-gradient(circle at 50% 42%, ${col} 0%, rgba(255,255,255,.3) 45%, transparent 74%)`
      : 'radial-gradient(circle at 50% 42%, #fff 0%, rgba(255,255,255,.4) 40%, transparent 72%)';
    this._animateVal(0, peak, upMs, E.outQuad, v => { this.flash.style.opacity = v; }, () => {
      this._animateVal(peak, 0, downMs, E.outCubic, v => { this.flash.style.opacity = v; });
    });
  }
  _setChroma(px) { this.scene.chroma = px; this.setChroma(this.reducedMotion ? Math.min(px, 4) : px); }
  _shake(amp, rotAmp, decay) {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeRotAmp = Math.max(this.shakeRotAmp, rotAmp || 0);
    this.shakeDecay = decay || 3.5;
  }

  // ---------------------------------------------------------------- tweens
  _animateVal(from, to, dur, ease, onUpd, onDone) {
    const tw = { from, to, dur, ease: ease || E.linear, t: 0, onUpd, onDone };
    this.tweens.push(tw); onUpd(from); return tw;
  }
  _updateTweens(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt * 1000;
      const p = tw.dur <= 0 ? 1 : clamp(tw.t / tw.dur, 0, 1);
      tw.onUpd(lerp(tw.from, tw.to, tw.ease(p)));
      if (p >= 1) { tw.onDone && tw.onDone(); this.tweens.splice(i, 1); }
    }
  }
  _killTweens() { this.tweens.length = 0; }
  _schedule(fn, ms) { const id = setTimeout(fn, ms); this.timers.push(id); return id; }

  // ---------------------------------------------------------------- RAF
  _start() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(n => this._loop(n)); } }
  _loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(n => this._loop(n));
    let dt = (now - this.last) / 1000; this.last = now; if (dt > 0.05) dt = 0.05;
    const sdt = dt * this.scene.slow;

    this._updateTweens(dt);
    this._updateP(sdt);
    this.scene.rayRot += sdt * 0.6;

    if (this.shakeAmp > 0.01 || this.shakeRotAmp > 0.001) {
      this.scene.shakeX = (Math.random() * 2 - 1) * this.shakeAmp;
      this.scene.shakeY = (Math.random() * 2 - 1) * this.shakeAmp;
      this.scene.shakeRot = (Math.random() * 2 - 1) * this.shakeRotAmp;
      this.shakeAmp *= (1 - this.shakeDecay * dt); this.shakeRotAmp *= (1 - this.shakeDecay * dt);
      this.setShake(this.scene.shakeX, this.scene.shakeY, this.scene.shakeRot);
    } else if (this.scene.shakeX || this.scene.shakeY || this.scene.shakeRot) {
      this.scene.shakeX = this.scene.shakeY = this.scene.shakeRot = 0; this.setShake(0, 0, 0);
    }

    this.ctxB.clearRect(0, 0, this.W, this.H);
    this._drawRays(this.ctxB); this._drawHalo(this.ctxB); this._drawOrb(this.ctxB);

    this.ctxF.clearRect(0, 0, this.W, this.H);
    this._updateDrawRings(this.ctxF, sdt); this._drawP(this.ctxF); this._drawLens(this.ctxF);
  }

  // ---------------------------------------------------------------- afterglow
  _startAfterglow(tier, rgb) {
    this._stopAfterglow();
    const { x: cx, y: cy } = this.focal(); const [r, g, b] = rgb;
    const rate = this._pc([1, 3, 5, 8, 12, 16][tier]);
    this.afterglowIv = setInterval(() => {
      for (let i = 0; i < rate; i++) {
        const ang = rand(0, 7), d = rand(30, 110);
        this._spawnP({ x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d - rand(0, 40),
          vx: rand(-14, 14), vy: rand(-40, -10),
          life: rand(0.9, 1.8), size: rand(1, 2.2) * (tier >= 2 ? 1.3 : 1),
          kind: tier >= 2 && i % 3 === 0 ? 1 : 3, rot: rand(0, 7), vr: rand(-2, 2), drag: 0.4, grav: -6,
          r, g, b });
      }
    }, 120);
  }
  _stopAfterglow() { if (this.afterglowIv) { clearInterval(this.afterglowIv); this.afterglowIv = null; } }

  // ---------------------------------------------------------------- crack (mythic crimson / primal PRISMATIC)
  _drawCrack(cx0, cy0, prismatic) {
    const c = this.ctxC; c.clearRect(0, 0, this.W, this.H);
    this.crackC.style.opacity = 0;
    this._animateVal(0, 1, 120, E.outQuad, v => { this.crackC.style.opacity = v; }, () => {
      this._animateVal(1, 0, 1400, E.inExpo, v => { this.crackC.style.opacity = v; });
    });
    const draw = () => {
      c.clearRect(0, 0, this.W, this.H);
      c.globalCompositeOperation = 'lighter';
      const branches = prismatic ? 12 : 9;
      for (let b = 0; b < branches; b++) {
        let x = cx0, y = cy0; const ang = b / branches * Math.PI * 2 + rand(-0.2, 0.2);
        let dir = ang; const seg = rand(6, 10), step = Math.max(this.W, this.H) / seg;
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < seg; s++) { dir += rand(-0.6, 0.6); x += Math.cos(dir) * step; y += Math.sin(dir) * step; c.lineTo(x, y); }
        // PRIMAL varies the crack stroke through the spectrum per branch; mythic is crimson.
        if (prismatic) { const pc = prismCol(); c.strokeStyle = `rgba(${pc[0]},${pc[1]},${pc[2]},.9)`; }
        else c.strokeStyle = 'rgba(255,80,140,.9)';
        c.lineWidth = rand(1, 3); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = rand(0.4, 1); c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    };
    draw(); this._schedule(draw, 80); this._schedule(draw, 180);
  }

  // ---------------------------------------------------------------- CLIMAX vfx (per tier, LAD-driven)
  // Thresholds follow the HERO ladder: rare>=1, epic>=2, legendary>=3, mythic>=4, PRIMAL>=5.
  _doClimax(tier, cx, cy, rgb, R) {
    const [rr, rg, rb] = rgb;
    // white flash — ladder peak (white for legendary+, else rarity tint)
    const fp = LAD.flash[tier];
    this._flashScreen(fp, tier >= 3 ? '#ffffff' : R.col, tier >= 3 ? 40 : 70, 240 + tier * 40);
    if (tier >= 3) this._schedule(() => this._flashScreen(fp * 0.7, R.col, 60, 360), 90);

    // shockwave rings — ladder count
    const ringN = LAD.rings[tier];
    for (let i = 0; i < ringN; i++) {
      this._schedule(() => {
        this._addRing({ x: cx, y: cy, r0: 8, r1: Math.max(this.W, this.H) * (0.6 + i * 0.11),
          dur: 0.5 + i * 0.06, w: 6 - i * 0.35, a: 0.85, rgb: i % 2 && tier >= 2 ? [255, 255, 255] : rgb });
      }, i * 65);
    }

    // radial particle burst — ladder count; PRIMAL cycles prismatic colours
    const burstN = this._pc(LAD.burst[tier]);
    const prism = R.prismatic;
    for (let i = 0; i < burstN; i++) {
      const ang = rand(0, 7), sp = rand(120, 560) * (0.6 + tier * 0.12);
      const k = i % 7 === 0 && tier >= 1 ? 1 : (tier >= 2 && i % 5 === 0 ? 2 : 0);
      const c = prism ? prismCol() : [rr, rg, rb];
      this._spawnP({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(0.5, 1.1) + tier * 0.08, size: rand(1.4, 3.4), kind: k, rot: rand(0, 7), vr: rand(-9, 9),
        drag: rand(1.2, 2.6), grav: tier >= 1 ? rand(40, 120) : 0, r: c[0], g: c[1], b: c[2] });
    }
    for (let i = 0; i < this._pc(burstN * 0.25); i++) {
      const ang = rand(0, 7), sp = rand(80, 320);
      this._spawnP({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: rand(0.25, 0.6), size: rand(1, 2.4), kind: 5, drag: 3, r: 255, g: 255, b: 255 });
    }

    // shake — ladder amp + rot
    const amp = LAD.shake[tier], rotAmp = LAD.shakeRot[tier];
    if (amp > 0) this._shake(amp, rotAmp, 3);

    // chromatic aberration — ladder px
    const cmax = LAD.chroma[tier] * (this.reducedMotion ? 0.5 : 1);
    if (cmax > 0) {
      this._animateVal(0, cmax, 90, E.outQuad, v => this._setChroma(v), () => {
        this._animateVal(cmax, 0, tier >= 4 ? 900 : 600, E.outCubic, v => this._setChroma(v));
      });
    }

    // lens flare — legendary+
    if (tier >= 3) {
      this._animateVal(0, tier >= 4 ? 1.1 : 0.9, 140, E.outQuad, v => { this.scene.lens = v; }, () => {
        this._animateVal(this.scene.lens, 0, 700, E.outCubic, v => { this.scene.lens = v; });
      });
    }

    // halo pulse — epic+
    if (tier >= 2) {
      this._animateVal(0, 1, 260, E.outQuad, v => { this.scene.halo = v; }, () => {
        this._animateVal(1, tier >= 3 ? 0.5 : 0, 900, E.outCubic, v => { this.scene.halo = v; });
      });
    }

    // confetti — ladder count
    const confN = this._pc(LAD.confetti[tier]);
    if (confN > 0) {
      const confCols = tier >= 5
        ? [[255, 80, 120], [255, 180, 60], [120, 255, 140], [80, 200, 255], [180, 120, 255], [255, 255, 255]]
        : tier >= 4
          ? [[255, 46, 110], [255, 154, 209], [255, 212, 94], [255, 255, 255], [143, 184, 255]]
          : tier >= 3 ? [[255, 176, 32], [255, 212, 120], [255, 255, 255], [255, 120, 60]]
            : [[143, 184, 255], [180, 107, 255], [255, 255, 255]];
      for (let i = 0; i < confN; i++) {
        this._schedule(() => {
          const cc = pick(confCols);
          this._spawnP({ x: cx + rand(-40, 40), y: cy + rand(-30, 10), vx: rand(-260, 260), vy: rand(-540, -260),
            life: rand(1.4, 2.6), size: rand(4, 8), kind: 4, rot: rand(0, 7), vr: rand(-10, 10),
            drag: 0.6, grav: rand(360, 620), r: cc[0], g: cc[1], b: cc[2] });
        }, i * 8);
      }
    }

    // MYTHIC (tier 4): crimson reality-crack + sustained crimson rays.
    // PRIMAL (tier 5): PRISMATIC crack (spectrum-varied stroke) + white-spectral rays
    // + an extra trio of rainbow shockwave rings — the biggest treatment in the ladder.
    if (tier >= 4) {
      this._drawCrack(cx, cy, tier >= 5);
      this._animateVal(this.scene.rays, 1.1, 200, E.outQuad, v => { this.scene.rays = v; });
      this.scene.rayCol = tier >= 5 ? [235, 245, 255] : [255, 46, 110];
      if (tier >= 5) {
        for (let i = 0; i < 3; i++) {
          const pc = prismCol();
          this._schedule(() => this._addRing({ x: cx, y: cy, r0: 10, r1: Math.max(this.W, this.H) * (0.9 + i * 0.16),
            dur: 0.7 + i * 0.08, w: 5, a: 0.8, rgb: pc }), 120 + i * 90);
        }
      }
    }
  }

  // ---------------------------------------------------------------- hero reveal (beat 5 + 6)
  _revealFrog(tier, R, pull, ctl) {
    const [rr, rg, rb] = hexRGB(R.col);
    this.onFrogReveal(tier);
    this._schedule(() => {
      this.sound('gacha_land_' + R.id);
      this.onNameBanner(tier, pull);
      this._addRing({ x: this.focal().x, y: this.focal().y, r0: 10, r1: 130, dur: 0.4, w: 4, a: 0.6, rgb: [rr, rg, rb] });
      if (tier >= 1) this._shake(tier >= 3 ? 4 : 2, 0, 4);

      for (let i = 0; i < R.pips; i++) {
        this._schedule(() => { this.sound('gacha_trait_pip'); this.onPip(i); }, 120 + i * 90);
      }

      this._startAfterglow(tier, [rr, rg, rb]);

      // TRAIT UNFURL — begins once pips have landed (end of HERO REVEAL beat)
      this._schedule(() => this.onTraits(pull), 240 + R.pips * 90 + 120);

      this._schedule(() => {
        ctl.finished = true;
        if (ctl.afterglowDone) ctl.afterglowDone();
        this.onAfterglowDone(); // fire the constructor hook (host completion / dismiss)
      }, tier >= 3 ? 600 : tier >= 1 ? 450 : 250);
    }, tier >= 3 ? 180 : tier >= 1 ? 120 : 80);
  }

  // ---------------------------------------------------------------- PLAY (6-beat)
  play(pull, opts = {}) {
    if (this.disposed) return null;
    this._resetSceneForPlay();
    const R = RARITY[pull.rarity] || RARITY.common, tier = R.tier;
    const [rr, rg, rb] = hexRGB(R.col);
    const { x: cx, y: cy } = this.focal();
    this.scene.cx = cx; this.scene.cy = cy;
    this.scene.orbCol = [rr, rg, rb]; this.scene.rayCol = [rr, rg, rb]; this.scene.haloCol = [255, 255, 255];
    this.scene.rayN = LAD.rays[tier];

    const ctl = { pull, finished: false, awaitingTap: false, afterglowDone: null };

    // ---- FAKE-OUT decision (epic+ only, ~25% or forced) ----
    const canFake = tier >= 2;
    const doFake = canFake && (opts.forceFake || Math.random() < 0.25);
    const fakeTierKey = doFake ? R_ORDER[Math.max(0, tier - 1 - ((Math.random() < 0.4 && tier >= 3) ? 1 : 0))] : null;
    const fakeR = doFake ? RARITY[fakeTierKey] : null;
    const fakeRGB = doFake ? hexRGB(fakeR.col) : null;

    // ---- timeline scaling ----
    const T = R.ms, antic = 220;
    const build = clamp(T * 0.42, 260, 1400);
    const tellAt = antic + build;
    const climaxAt = tellAt + clamp(T * 0.10, 120, 340);

    // BEAT 1: ANTICIPATION
    this.sound('gacha_buildup');
    const orbColActive = doFake ? fakeRGB : [rr, rg, rb];
    this.scene.orbCol = orbColActive.slice();
    this._animateVal(0, tier >= 1 ? 0.6 : 0.35, antic, E.outCubic, v => { this.scene.orb = v; });
    for (let i = 0; i < this._pc(tier >= 1 ? 18 : 8); i++) {
      const ang = rand(0, 7), d = rand(80, 150);
      this._spawnP({ x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d,
        vx: -Math.cos(ang) * d * 1.4, vy: -Math.sin(ang) * d * 1.4,
        life: antic / 1000 + 0.15, size: 2.5, kind: 0, drag: 1.2,
        r: orbColActive[0], g: orbColActive[1], b: orbColActive[2] });
    }

    // BEAT 2: BUILD-UP
    this._schedule(() => {
      this.sound('gacha_buildup');
      this._animateVal(this.scene.orb, tier >= 1 ? 0.9 : 0.55, build * 0.8, E.inQuad, v => { this.scene.orb = v; });
      this._animateVal(0, tier >= 1 ? 1 : 0.4, build, E.outQuad, v => { this.scene.swirl = v; });
      if (tier >= 1) this._shake(tier >= 3 ? 2.5 : 1.2, 0, 2);
      const starN = this._pc([6, 26, 48, 80, 120, 160][tier]);
      let spawned = 0;
      const iv = setInterval(() => {
        const batch = Math.ceil(starN / 12);
        for (let i = 0; i < batch && spawned < starN; i++, spawned++) {
          const ang = rand(0, 7), d = rand(160, Math.max(this.W, this.H) * 0.7);
          const col = doFake ? fakeRGB : [rr, rg, rb];
          this._spawnP({ x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d,
            vx: -Math.cos(ang) * d * rand(1.2, 2.0), vy: -Math.sin(ang) * d * rand(1.2, 2.0),
            life: rand(0.4, 0.8), size: rand(0.8, 1.8) * (tier >= 2 ? 1.4 : 1), kind: tier >= 1 ? 1 : 0,
            rot: rand(0, 7), vr: rand(-4, 4), drag: 0.6, r: col[0], g: col[1], b: col[2] });
        }
        if (spawned >= starN) clearInterval(iv);
      }, 38);
      this._starIv = iv;

      if (doFake) {
        const upAt = build * 0.62;
        this._schedule(() => {
          this.sound('gacha_upgrade');
          this.onFakeUpgrade(pull.rarity);
          this.scene.orbCol = [rr, rg, rb]; this.scene.rayCol = [rr, rg, rb];
          this._flashScreen(0.6, '#ffffff', 50, 300);
          this._shake(6, 0.2, 3);
          this._addRing({ x: cx, y: cy, r0: 6, r1: Math.max(this.W, this.H) * 0.85, dur: 0.6, w: 6, a: 0.95, rgb: [255, 255, 255] });
          for (let i = 0; i < this._pc(70); i++) {
            const ang = rand(0, 7), sp = rand(200, 520);
            this._spawnP({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: rand(0.3, 0.6), size: rand(1, 2.2), kind: 1, rot: rand(0, 7), vr: rand(-8, 8), drag: 2.5, r: rr, g: rg, b: rb });
          }
          this._animateVal(this.scene.orb, 1.0, 180, E.outBack, v => { this.scene.orb = v; });
        }, upAt);
      }
      if (tier >= 2) {
        this._schedule(() => this._animateVal(0, tier >= 4 ? 0.8 : 0.6, build * 0.5, E.outCubic, v => { this.scene.rays = v; }), build * 0.4);
      }
    }, antic);

    // BEAT 3: RARITY TELL
    this._schedule(() => {
      this.sound('gacha_tell_' + R.id);
      this.tint.style.background = `radial-gradient(circle at 50% 42%, ${R.col} 0%, transparent 70%)`;
      this._animateVal(0, Math.min(0.14 + tier * 0.06, 0.4), 220, E.outQuad, v => { this.tint.style.opacity = v; });
      this._animateVal(this.scene.orb, 1.0, tellAt < climaxAt ? (climaxAt - tellAt) : 160, E.inQuad, v => { this.scene.orb = v; });
      if (tier >= 3) this._animateVal(this.scene.rays, tier >= 4 ? 1 : 0.85, 300, E.outCubic, v => { this.scene.rays = v; });
    }, tellAt);

    // BEAT 4: CLIMAX
    this._schedule(() => {
      this.sound('gacha_climax_' + R.id);
      this._doClimax(tier, cx, cy, [rr, rg, rb], R);
      if (!this.reducedMotion && LAD.slowmo[tier] < 1) {
        this.scene.slow = LAD.slowmo[tier];
        this._schedule(() => { this._animateVal(this.scene.slow, 1, tier >= 4 ? 520 : 380, E.outCubic, v => { this.scene.slow = v; }); },
          tier >= 4 ? 300 : 220);
      }
      // BEAT 5 + 6
      this._schedule(() => this._revealFrog(tier, R, pull, ctl), tier >= 3 ? 260 : tier >= 1 ? 160 : 110);
    }, climaxAt);

    this.curReveal = ctl;
    return ctl;
  }

  // finish the current reveal instantly (SKIP / advance mid-animation)
  skip() {
    this._clearTimers();
    this._killTweens();
    this._stopAfterglow();
  }

  _resetSceneForPlay() {
    this._clearTimers();
    this._killTweens();
    this._stopAfterglow();
    this._clearParticles();
    this.rings.length = 0;
    const s = this.scene;
    s.orb = s.rays = s.halo = s.swirl = s.lens = 0; s.slow = 1;
    s.shakeX = s.shakeY = s.shakeRot = 0; s.chroma = 0;
    this.shakeAmp = 0; this.shakeRotAmp = 0;
    this._setChroma(0); this.setShake(0, 0, 0);
    this.ctxC.clearRect(0, 0, this.W, this.H);
    this.crackC.style.opacity = 0; this.flash.style.opacity = 0; this.tint.style.opacity = 0;
  }

  _clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.length = 0;
    if (this._starIv) { clearInterval(this._starIv); this._starIv = null; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    this._clearTimers();
    this._killTweens();
    this._stopAfterglow();
    window.removeEventListener('resize', this._resize);
    if (this._ro) { try { this._ro.disconnect(); } catch (_) { /* no-op */ } this._ro = null; }
    for (const el of [this.fxBack, this.crackC, this.fxFront, this.tint, this.flash]) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
}

// ---------------------------------------------------------------------------
// MergeCombat wrapper — mounts a centered reward element and drives it from the
// engine's injected hooks. `containerEl` is a caller-mounted overlay div
// (position:fixed; inset:0; z-index:1000). The engine appends its own canvases
// + flash/tint overlays into it; this wrapper appends the reward element.
// ---------------------------------------------------------------------------

// map the public rarity strings onto the engine's RARITY tiers
const CHEST_RARITY_TIERS = {
  common: 'common',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary',
};

/**
 * Play the chest reveal cinematic inside `containerEl`, then FLY the revealed
 * contents to where they belong (`flyTo`) as a currency-explosion WHILE the
 * reveal VFX shrink to nothing — finally calling `onDone` (after which combat
 * should resume).
 *
 * The engine (canvases + flash/tint) lives in its OWN sub-wrapper so it can be
 * shrunk to nothing independently of the reward element that flies off.
 *
 * @param {HTMLElement} containerEl  overlay div (position:fixed; inset:0; z-index:1000)
 * @param {{rarity?, rewardAsset?, rewardEmoji?, rarityColor?, focal?, flyTo?}} opts
 *        rewardAsset = { img?, emoji? } (a resolved asset); focal/flyTo = viewport pts.
 * @param {() => void} [onDone]  called once the fly-off + shrink complete.
 * @returns {GachaRevealEngine} the engine instance
 */
export function playChestReveal(
  containerEl,
  { rarity = 'rare', rewardAsset = null, rewardEmoji = '🎁', rarityColor = null, focal = null, flyTo = null } = {},
  onDone,
) {
  const tierRarity = CHEST_RARITY_TIERS[rarity] || 'rare';
  const reducedMotion = !!(typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const glow = rarityColor ? `drop-shadow(0 0 14px ${rarityColor})` : '';

  // Sub-wrapper for the engine's canvases/overlays, so the reveal VFX can shrink
  // to nothing (toward the focal point) independently of the flying reward.
  const engineWrap = document.createElement('div');
  engineWrap.style.cssText = [
    'position:absolute', 'inset:0', 'pointer-events:none', 'will-change:transform,opacity',
    `transform-origin:${focal ? `${focal.x}px ${focal.y}px` : '50% 42%'}`,
  ].join(';') + ';';
  containerEl.appendChild(engineWrap);

  // The revealed contents (host-owned) — sibling of engineWrap so it flies off freely.
  let rewardEl = null;   // outer: centering + shake
  let rewardInner = null; // inner: pop-in scale + white→normal reveal
  const ensureRewardEl = () => {
    if (rewardEl) return;
    rewardEl = document.createElement('div');
    rewardEl.style.cssText = [
      'position:absolute',
      focal ? `left:${focal.x}px` : 'left:50%',
      focal ? `top:${focal.y}px` : 'top:42%',
      'transform:translate(-50%,-50%)', 'pointer-events:none', 'z-index:12',
      'will-change:transform,filter,opacity',
    ].join(';') + ';';
    rewardInner = document.createElement('div');
    rewardInner.style.cssText = `display:flex;align-items:center;justify-content:center;width:78px;height:78px;${glow}`;
    if (rewardAsset && rewardAsset.img) {
      const im = document.createElement('img');
      im.src = rewardAsset.img; im.draggable = false;
      im.style.cssText = 'width:100%;height:100%;object-fit:contain;';
      rewardInner.appendChild(im);
    } else {
      rewardInner.textContent = (rewardAsset && rewardAsset.emoji) || rewardEmoji;
      rewardInner.style.fontSize = '64px';
    }
    rewardEl.appendChild(rewardInner);
    containerEl.appendChild(rewardEl);
  };

  const engine = new GachaRevealEngine(engineWrap, {
    reducedMotion,
    focal: focal || undefined,
    sound: () => {},

    // reveal — pop the contents in, FLASHING FROM WHITE to normal.
    onFrogReveal: () => {
      ensureRewardEl();
      if (rewardInner && rewardInner.animate) {
        rewardInner.animate(
          [
            { transform: 'scale(0.35)', opacity: 0, filter: 'brightness(6) saturate(0)' },
            { transform: 'scale(1.15)', opacity: 1, filter: 'brightness(2.4) saturate(0.5)', offset: 0.6 },
            { transform: 'scale(1)', opacity: 1, filter: 'brightness(1) saturate(1)' },
          ],
          { duration: reducedMotion ? 140 : 460, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'both' },
        );
      }
    },
    setShake: (x, y, rot) => {
      if (rewardEl) rewardEl.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) rotate(${rot}deg)`;
    },
    setChroma: (px) => {
      if (rewardInner) {
        rewardInner.style.filter = px
          ? `drop-shadow(${px}px 0 rgba(255,0,60,0.9)) drop-shadow(${-px}px 0 rgba(0,220,255,0.9))`
          : glow;
      }
    },

    // reveal held — HOLD the reward ~0.8s longer (the chest reveal itself is <0.5s,
    // so a half-attention glance misses it) before flying the contents off.
    onAfterglowDone: () => { if (reducedMotion) flyOff(); else setTimeout(flyOff, 800); },
  });

  const cleanup = () => {
    try { engine.dispose(); } catch { /* no-op */ }
    if (engineWrap.parentNode) engineWrap.remove();
    if (rewardEl && rewardEl.parentNode) rewardEl.remove();
  };

  // A currency-explosion sparkle: bursts out then arcs into the destination.
  const spawnSparkle = (from, to, color, delay) => {
    const s = document.createElement('div');
    s.style.cssText =
      `position:absolute;left:0;top:0;width:11px;height:11px;border-radius:50%;background:${color};` +
      `filter:drop-shadow(0 0 6px ${color});pointer-events:none;z-index:11;transform:translate(${from.x}px,${from.y}px);`;
    containerEl.appendChild(s);
    const bx = from.x + (Math.random() * 2 - 1) * 70;
    const by = from.y - Math.random() * 70 - 20;
    const a = s.animate(
      [
        { transform: `translate(${from.x}px,${from.y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${bx}px,${by}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${to.x}px,${to.y}px) scale(0.3)`, opacity: 0 },
      ],
      { duration: 560, delay, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' },
    );
    a.finished.catch(() => {}).then(() => s.remove());
  };

  function flyOff() {
    // Stop the engine from writing to the reward element while it flies.
    engine.setShake = () => {};
    engine.setChroma = () => {};

    const W = (typeof window !== 'undefined' && window.innerWidth) || 480;
    const H = (typeof window !== 'undefined' && window.innerHeight) || 800;
    const src = focal || { x: W / 2, y: H * 0.42 };
    const target = flyTo || { x: src.x, y: src.y - 120 };
    const col = rarityColor || '#ffd45e';

    // 1) shrink the reveal VFX to nothing (toward the focal point) — SIMULTANEOUS.
    if (engineWrap.animate) {
      engineWrap.animate(
        [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.02)', opacity: 0 }],
        { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' },
      );
    }
    // 2) currency-explosion of sparkles toward where the contents belong.
    for (let i = 0; i < 8; i++) spawnSparkle(src, target, col, i * 32);

    // 3) the contents themselves arc to the destination and shrink.
    let flew = Promise.resolve();
    if (rewardEl && rewardEl.animate) {
      const dx = target.x - src.x;
      const dy = target.y - src.y;
      flew = rewardEl
        .animate(
          [
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
            { transform: `translate(-50%,-50%) translate(${dx * 0.5}px,${dy * 0.5 - 60}px) scale(0.85)`, opacity: 1, offset: 0.5 },
            { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(0.35)`, opacity: 0.55 },
          ],
          { duration: 560, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' },
        )
        .finished.catch(() => {});
    }
    // 4) bounce the destination (the Gear nav tab) as the contents land.
    const nav = flyTo ? document.querySelector('[data-nav="gear"]') : null;
    if (nav && nav.animate) {
      nav.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
        { duration: 300, delay: 470, easing: 'ease-out' });
      // …and a 2s gold pulse so the player SEES where the gear went.
      nav.classList.add('nav-pulse');
      setTimeout(() => nav.classList.remove('nav-pulse'), 2000);
    }

    Promise.resolve(flew).then(() => { cleanup(); onDone && onDone(); });
  }

  engine.play({ rarity: tierRarity }, {});
  return engine;
}
