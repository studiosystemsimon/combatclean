// ─────────────────────────────────────────────────────────────────────────────
// FX ENGINE (view layer) — a single Canvas2D overlay singleton driving the
// projectile TRAILS (system 1) and IMPACT explosions (system 2), ported from
// FrogGame's trails-3d ribbon algorithm + effects.js/dfx-core composite recipe
// (see docs/froggame-vfx-port.md §1–2). Pure presentation: owns its own transient
// lists, never touches game state.
// ─────────────────────────────────────────────────────────────────────────────

import { rand, lerpHex, easeOutExpo, easeOutCubic, bakeGlow } from './fx-math.js';
import { VFX_CONFIG } from '../../data/config.js';

// All fx-engine tuning is config (_vfx.json → engine). Destructure once.
const VE = VFX_CONFIG.engine;
const { spineN: SPINE_N, minSpacingPx: MIN_SPACING_PX, maxAgeBase: MAX_AGE_BASE, lengthRef: TRAIL_LENGTH_REF, lutN: TRAIL_LUT_N, maxParticles: MAX_PARTICLES } = VE.trail;
const IMPACT_CFG = VE.impact;

class FxEngine {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.W = 0;
    this.H = 0;
    this.DPR = 1;
    this.projectiles = [];
    this.particles = [];
    this.impacts = [];
    this.raf = null;
    this.last = 0;
    this._glow = {};
    this._rect = null; // cached canvas client rect (invalidated on resize)
    this.shakeAmt = 0;
    this.flashPeak = 0;
    this.flashDur = 0.14;
    this.flashT = 0;
  }

  mount(canvas) {
    if (this.canvas) this.unmount();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement);
    this.last = performance.now();
    this.raf = requestAnimationFrame((n) => this._loop(n));
  }

  unmount() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this._ro) this._ro.disconnect();
    this.projectiles.length = 0;
    this.particles.length = 0;
    this.impacts.length = 0;
    if (this.canvas) this.canvas.style.transform = '';
    this.canvas = null;
    this.ctx = null;
  }

  _resize() {
    if (!this.canvas) return;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.DPR = Math.min(VE.dprMax, window.devicePixelRatio || 1);
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(this.W * this.DPR);
    this.canvas.height = Math.round(this.H * this.DPR);
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this._rect = null; // canvas moved/resized → invalidate the cached client rect
  }

  // Convert viewport client coords → app-local canvas coords. The canvas is a fixed
  // full-screen overlay, so its client rect only changes on resize — cache it there.
  appPt(cx, cy) {
    const r = this._rect || (this._rect = this.canvas.getBoundingClientRect());
    return { x: cx - r.left, y: cy - r.top };
  }
  elCenter(el) {
    const r = el.getBoundingClientRect();
    return this.appPt(r.left + r.width / 2, r.top + r.height / 2);
  }
  cellCenter(index) {
    const el = document.querySelector(`[data-cell-index="${index}"]`);
    return el ? this.elCenter(el) : null;
  }

  // Additive glow stamp. Sets only the two properties it needs and resets them —
  // cheaper than a full ctx.save()/restore() per stamp (called many times/frame).
  _stampGlow(x, y, size, hex, alpha = 1) {
    const s = this._glow[hex] || (this._glow[hex] = bakeGlow(hex));
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(s, x - size, y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  shake(amp) {
    this.shakeAmt = Math.max(this.shakeAmt, amp);
    this._wake();
  }

  // True while anything is animating. When false, the rAF loop parks itself so it no
  // longer burns a full DPR-scaled clear + 6 step passes 60×/s on every screen forever.
  _active() {
    return (
      this.projectiles.length || this.particles.length || this.impacts.length ||
      this.flashPeak > 0 || this.shakeAmt > 0
    );
  }

  // Restart the loop if it has parked (no-op while it is already running).
  _wake() {
    if (this.raf == null && this.ctx) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((n) => this._loop(n));
    }
  }

  _loop(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05; // clamp after tab-away
    if (!this.ctx) { this.raf = null; return; }
    this.ctx.clearRect(0, 0, this.W, this.H);
    this._stepProjectiles(dt);
    this._stepImpacts(dt);
    this._stepParticles(dt);
    this._drawFlash(dt);
    this._stepShake(dt);
    // Park when idle; a spawn/flash/shake calls _wake() to restart.
    this.raf = this._active() ? requestAnimationFrame((n) => this._loop(n)) : null;
  }

  // ── Screen flash (white full-canvas fade — for big rarity-up / climax beats) ──
  flash(peak = VE.flash.peak, ms = VE.flash.ms, color = VE.flash.color) {
    this.flashPeak = Math.max(this.flashPeak, peak);
    this.flashDur = ms / 1000;
    this.flashT = 0;
    this.flashColor = color;
    this._wake();
  }

  _drawFlash(dt) {
    if (this.flashPeak <= 0) return;
    this.flashT += dt;
    const k = this.flashT / this.flashDur;
    if (k >= 1) {
      this.flashPeak = 0;
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = this.flashPeak * (1 - k);
    ctx.fillStyle = this.flashColor || '#fff';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
  }

  // ── System 3: CONFETTI explosion (flat paper pieces erupt 360° biased upward,
  //    then flutter + spin down under gravity). Cheap on purpose: source-over flat
  //    fillRects, NO additive glow stamps — far lighter than the old firework embers. ─
  confetti(x, y, { count = VE.confetti.count, colors = ['#ffffff'], power = 1 } = {}) {
    const CF = VE.confetti;
    const budget = Math.max(0, MAX_PARTICLES - this.particles.length); // cap the spike
    const n = Math.min(budget, count);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(...CF.speed) * power;
      this.particles.push({
        kind: 'confetti',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(...CF.up) * power, // upward bias → erupts, then falls
        t: 0, life: rand(...CF.life),
        size: rand(...CF.size), aspect: rand(...CF.aspect),
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI * 2, vrot: rand(-CF.vrot, CF.vrot),
        grav: rand(...CF.grav),
        swayF: rand(...CF.swayFreq), swayP: Math.random() * Math.PI * 2, swayA: rand(...CF.swayAmp),
      });
    }
    this._wake();
  }

  _stepShake(dt) {
    // Shake the OVERLAY CANVAS only (not the whole .app tree). App-root shake
    // re-composited the entire UI (header, currency bar, board, navbar) every frame
    // and jittered the HUD. Combat sprite-shake stays handled by FxLayer's shakeArena().
    const el = this.canvas;
    if (!el) return;
    if (this.shakeAmt > VE.shake.restThreshold) {
      const a = this.shakeAmt;
      el.style.transform = `translate(${rand(-a, a)}px,${rand(-a, a)}px)`;
      this.shakeAmt *= Math.pow(VE.shake.decayBase, dt); // fast decay to rest
    } else if (el.style.transform) {
      el.style.transform = '';
      this.shakeAmt = 0;
    }
  }

  // ── System 1: trails ───────────────────────────────────────────────────────
  spawnTrail(from, to, opts = {}) {
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = opts.speed || VE.spawnTrail.speed;
    const dur = dist / speed;
    const head = opts.color || VE.spawnTrail.head;
    const tail = opts.tail || opts.color || VE.spawnTrail.tail;
    // Precompute a small head→tail colour LUT once per trail so the per-frame,
    // per-segment draw indexes it instead of allocating an rgb() string each time.
    const lut = [];
    for (let k = 0; k < TRAIL_LUT_N; k++) lut.push(lerpHex(head, tail, k / (TRAIL_LUT_N - 1)));
    this.projectiles.push({
      x: from.x, y: from.y, tx: to.x, ty: to.y,
      vx: dx / dur, vy: dy / dur,
      t: 0, dur, r: opts.r || VE.spawnTrail.r,
      head, tail, lut,
      halfW: opts.width || VE.spawnTrail.width,
      maxAge: MAX_AGE_BASE * ((opts.length || VE.spawnTrail.length) / TRAIL_LENGTH_REF),
      spine: [], lastX: null, lastY: null,
      onHit: opts.onHit,
      glow: opts.glow !== false,
    });
    this._wake();
  }

  _stepProjectiles(dt) {
    const ctx = this.ctx;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const done = p.t >= p.dur;
      if (done) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      for (const s of p.spine) s.age += dt;
      while (p.spine.length && p.spine[0].age > p.maxAge) p.spine.shift();
      if (p.lastX === null || (p.x - p.lastX) ** 2 + (p.y - p.lastY) ** 2 > MIN_SPACING_PX ** 2) {
        p.spine.push({ x: p.x, y: p.y, age: 0 });
        if (p.spine.length > SPINE_N) p.spine.shift();
        p.lastX = p.x;
        p.lastY = p.y;
      }

      if (p.spine.length >= 2) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 1; k < p.spine.length; k++) {
          const a = p.spine[k - 1];
          const b = p.spine[k];
          const ageNorm = Math.min(1, b.age / p.maxAge);
          const w = (1 - ageNorm) * p.halfW * 2;
          ctx.strokeStyle = p.lut[(ageNorm * (TRAIL_LUT_N - 1)) | 0];
          ctx.globalAlpha = (1 - ageNorm) * VE.spawnTrail.alpha;
          ctx.lineWidth = Math.max(0.5, w);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (p.glow) this._stampGlow(p.x, p.y, p.r * VE.spawnTrail.glowRMul, p.head, VE.spawnTrail.glowAlpha);
      ctx.fillStyle = p.head;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      if (done) {
        if (p.onHit) p.onHit(p.tx, p.ty);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ── System 2: impact ───────────────────────────────────────────────────────
  impact(x, y, opts = {}) {
    const tier = opts.tier || 'normal';
    const tm = IMPACT_CFG.tier[tier] || IMPACT_CFG.tier.normal;
    const color = opts.color || IMPACT_CFG.color;
    const r = opts.r || IMPACT_CFG.r;
    const { disc, ring, ring2 } = IMPACT_CFG;

    this.impacts.push({ kind: 'disc', x, y, t: 0, dur: disc.dur, r0: r * disc.r0Mul, r1: r * disc.r1Mul, color });
    this.impacts.push({ kind: 'ring', x, y, t: 0, dur: ring.dur * tm.life, r0: r, r1: r * (tier === 'crit' ? ring.r1MulCrit : ring.r1Mul), w0: ring.w0, color });
    this.impacts.push({ kind: 'ring', x, y, t: -ring2.delay, dur: ring2.dur, r0: r, r1: r * ring2.r1Mul, w0: ring2.w0, color: ring2.color });

    const n = Math.round(IMPACT_CFG.count * tm.count);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * IMPACT_CFG.spread;
      const sp = IMPACT_CFG.speed * IMPACT_CFG.speedMul * tm.speed * IMPACT_CFG.debrisSpeedMul * (IMPACT_CFG.speedJitter[0] + Math.random() * IMPACT_CFG.speedJitter[1]);
      const size = (IMPACT_CFG.sizeMin + Math.random() * (IMPACT_CFG.sizeMax - IMPACT_CFG.sizeMin)) * tm.size;
      this.particles.push({ x, y, bvx: Math.cos(a) * sp, bvy: Math.sin(a) * sp, t: 0, life: IMPACT_CFG.life * tm.life, size, color });
    }
    // Callers can opt out of the built-in tier shake (opts.shake === false) and
    // drive their own — the merge board does this so only big merges shake.
    if (opts.shake !== false) {
      if (tier === 'crit') this.shake(IMPACT_CFG.shakeCrit);
      else if (tier === 'heavy') this.shake(IMPACT_CFG.shakeHeavy);
    }
    this._wake();
  }

  _stepImpacts(dt) {
    const ctx = this.ctx;
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.t += dt;
      if (im.t < 0) continue; // pre-delay (secondary ring)
      const p = Math.min(1, im.t / im.dur);
      if (im.kind === 'disc') {
        const rad = im.r0 + (im.r1 - im.r0) * easeOutCubic(p);
        this._stampGlow(im.x, im.y, rad, im.color, 0.9 * (1 - p));
      } else {
        const rad = im.r0 + (im.r1 - im.r0) * easeOutExpo(p);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - p) * IMPACT_CFG.ringAlpha;
        ctx.strokeStyle = im.color;
        ctx.lineWidth = im.w0 * (1 - p * IMPACT_CFG.ringTaper);
        ctx.beginPath();
        ctx.arc(im.x, im.y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (p >= 1) this.impacts.splice(i, 1);
    }
  }

  _stepParticles(dt) {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.t += dt;
      const k = pt.t / pt.life;
      if (k >= 1) {
        this.particles.splice(i, 1);
        continue;
      }

      // CONFETTI paper piece — a flat rotated rect with air-drag + gravity + a flutter
      // sway, fading over the last quarter of life. Deliberately cheap: source-over
      // fillRect, NO additive glow stamp (the old firework embers were the heavy path).
      if (pt.kind === 'confetti') {
        pt.vx *= Math.pow(VE.confetti.dragBase, dt); // horizontal air drag → settles into a flutter
        pt.vy = Math.min(pt.vy + pt.grav * dt, VE.confetti.termVel); // gravity → a gentle terminal fall
        pt.x += pt.vx * dt + Math.sin(pt.t * pt.swayF + pt.swayP) * pt.swayA * dt;
        pt.y += pt.vy * dt;
        pt.rot += pt.vrot * dt;
        const a = k > VE.confetti.fadeFrom ? (1 - k) / (1 - VE.confetti.fadeFrom) : 1;
        const w = pt.size;
        const h = pt.size * pt.aspect;
        // translate/rotate + inverse instead of save()/restore() (which snapshots the
        // whole canvas state) — cheaper per piece across a whole confetti burst.
        ctx.globalAlpha = a;
        ctx.fillStyle = pt.color;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.rot);
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.rotate(-pt.rot);
        ctx.translate(-pt.x, -pt.y);
        ctx.globalAlpha = 1;
        continue;
      }

      // Default: impact debris shard (sineHalt: base → halt over life).
      const vel = Math.cos((k * Math.PI) / 2);
      pt.x += pt.bvx * vel * dt;
      pt.y += pt.bvy * vel * dt;
      const alpha = 1 - k;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = VE.debris.stroke;
      ctx.lineWidth = 1;
      const s = pt.size * (VE.debris.sizeBase + VE.debris.sizeAlpha * alpha);
      ctx.beginPath();
      ctx.rect(pt.x - s / 2, pt.y - s / 2, s, s);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

export const fx = new FxEngine();
