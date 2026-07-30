// ─────────────────────────────────────────────────────────────────────────────
// LIMIT-FILL display store (view layer). The limit bar must fill IN SYNC with the
// arriving energy mote, not snap when the reducer grants the energy. On the
// merge/order event we HOLD the displayed frac; when the hero's mote LANDS we ease
// the displayed frac to the current true frac; a fallback timer snaps it so a dropped
// mote never strands a bar below its true charge. Mirrors counter-tween.js in shape.
// Pure presentation — holds no game state; LimitBar supplies the live true frac each
// frame via displayFrac(), which the mote's onHit reads back through landLimit().
// ─────────────────────────────────────────────────────────────────────────────
import { VFX_CONFIG } from '../../data/config.js';

const EASE = {
  linear: (t) => t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInCubic: (t) => t * t * t,
};
const fillCfg = () => VFX_CONFIG.combat.limitCharge.fill;

const S = {}; // heroId -> { disp, from, target, start, dur, ease, holding, holdAt, trueSeen, lastTrue }
const ent = (id) =>
  S[id] || (S[id] = { disp: null, from: 0, target: 0, start: 0, dur: 0, ease: EASE.easeOutCubic, holding: false, holdAt: 0, trueSeen: 0, lastTrue: 0 });

// Event fired (a merge/order just charged this hero): freeze the displayed frac until the mote lands.
export function holdLimit(id) {
  const s = ent(id);
  s.holding = true;
  s.holdAt = performance.now();
  s.dur = 0;
}

// This hero's mote landed: ease the displayed frac → the latest true frac the bar has seen.
export function landLimit(id) {
  const f = fillCfg();
  const s = ent(id);
  s.holding = false;
  s.from = s.disp == null ? s.trueSeen : s.disp;
  s.target = s.trueSeen;
  s.start = performance.now();
  s.dur = f.fillCatchupMs;
  s.ease = EASE[f.easing] || EASE.easeOutCubic;
}

// Read the displayed frac to render — called each frame by LimitBar with the live true frac.
export function displayFrac(id, trueFrac) {
  const f = fillCfg();
  const s = ent(id);
  if (s.disp == null) { s.disp = trueFrac; s.lastTrue = trueFrac; } // init
  // TRUE increased (the sim just granted charge) → HOLD the displayed value until the mote lands.
  // Auto-holding here makes the fill robust even if the event's holdLimit() runs a frame late (the
  // FxLayer fx-drain is a passive effect; this rAF read can win the race), so the bar never snaps.
  if (trueFrac > s.lastTrue + 1e-4) { s.holding = true; s.holdAt = performance.now(); s.dur = 0; }
  s.lastTrue = trueFrac;
  s.trueSeen = trueFrac;
  // Fire / reset drops the true frac → snap the display down with it (never lag a drain).
  if (trueFrac < s.disp - 1e-4) { s.disp = trueFrac; s.target = trueFrac; s.holding = false; s.dur = 0; return s.disp; }
  // Held (event fired, mote in flight) → hold the displayed value; fallback-snap if a land never arrives.
  if (s.holding) { if (performance.now() - s.holdAt > f.fallbackMs) landLimit(id); return s.disp; }
  // Easing toward the true frac after a land.
  if (s.dur > 0) { const t = Math.min(1, (performance.now() - s.start) / s.dur); s.disp = s.from + (s.target - s.from) * s.ease(t); if (t >= 1) { s.disp = s.target; s.dur = 0; } return s.disp; }
  // Idle: track truth (no pending animation).
  s.disp = trueFrac; s.target = trueFrac;
  return s.disp;
}
