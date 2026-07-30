// ─────────────────────────────────────────────────────────────────────────────
// LIMIT-ENERGY VFX (view layer). Owns the limit-charge mote: energy streams from the
// merged board cell (or the fulfilled order card) up to each charged hero's limit bar.
// The mote pops out sideways, curls in, accelerates, rides a glowing pulsing head, and
// docks with a BOF on a horizontal edge at the bar's bottom — the bar FILLS in sync
// with the arriving mote (limit-fill store) and flashes on arrival (the in-game
// pulseLimitBar). Per-bucket intensity scales with the merge tier; ORDERS use the MID
// bucket. Extracted from FxLayer — this is the single limit-charge path (all tuning is
// data: _vfx.json → combat.limitCharge / combat.limitPulse / combatColors).
// ─────────────────────────────────────────────────────────────────────────────
import { fx } from './fx-engine.js';
import { holdLimit, landLimit } from './limit-fill.js';
import { VFX_CONFIG } from '../../data/config.js';

const CC = VFX_CONFIG.combatColors;
const CB = VFX_CONFIG.combat;

// The in-game bar flash — combat.limitPulse: whole-bar brightness+scale peak AND a background-colour
// pulse (the bar bed flashes) at the peak, ease-out. Fires on every mote landing (merge AND order).
export function pulseLimitBar(bar) {
  if (!bar || !bar.animate) return;
  const lp = CB.limitPulse;
  const rest = getComputedStyle(bar).backgroundColor; // flash back to the bar's own resting bg (no duplicated value)
  bar.animate(
    [
      { filter: 'brightness(1)', transform: 'scale(1)', backgroundColor: rest },
      { filter: `brightness(${lp.brightness})`, transform: `scale(${lp.scale})`, backgroundColor: lp.bg, offset: lp.offset },
      { filter: 'brightness(1)', transform: 'scale(1)', backgroundColor: rest },
    ],
    { duration: lp.ms, easing: 'ease-out' },
  );
}

// The READY pop — fired by LimitBar when a bar visually caps.
export function limitReadyPop(bar) {
  if (!bar) return;
  const r = CB.limitCharge.ready;
  const c = fx.elCenter(bar);
  if (c) {
    fx.impact(c.x, c.y, { tier: 'heavy', color: CC.limitFlash, r: r.impactR });
    fx.confetti(c.x, c.y, { colors: [CC.limitFlash, CC.limitBreak], count: r.sparkleCount, power: CB.limitCharge.sparklePower + 0.2 });
  }
  if (bar.animate) bar.animate(
    [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: `scale(${r.popScale})`, filter: `brightness(${r.popBrightness})` }, { transform: 'scale(1)', filter: 'brightness(1)' }],
    { duration: r.popMs, easing: 'ease-out' },
  );
}

// The arrival BOF explosion + the in-game bar flash.
function bof(x, y, bar, off) {
  const lc = CB.limitCharge, baseR = lc.tier.impactR[off];
  fx.impact(x, y, { tier: 'heavy', color: CC.limitFlash, r: baseR * lc.explode.rMul, debris: lc.explode.debris });
  if (lc.explode.flash) fx.impact(x, y, { tier: 'normal', color: '#ffffff', r: baseR * lc.explode.rMul * 0.7 });
  fx.confetti(x, y, { colors: [CC.limitFlash, CC.limitBreak, '#ffffff'], count: lc.tier.sparkle[off], power: lc.sparklePower });
  pulseLimitBar(bar);
}

// Drain the controller's limitCharge fx event → one energy mote per charged hero.
export function runLimitEnergy(ev) {
  const lc = CB.limitCharge;
  // Intensity bucket: orders → lc.orderBucket (data); merges → by result tier (3/4/5+ → 0/1/2).
  const off = ev.orderId != null ? lc.orderBucket : Math.max(0, Math.min(2, (ev.tier || 3) - 3));

  // Source anchor: fulfilled order card, or the merged board cell; fallback to the combat panel centre.
  let from = null;
  if (ev.orderId != null) {
    const card = Array.from(document.querySelectorAll('.orders .order')).find((c) => c.getAttribute('data-order-id') === String(ev.orderId));
    from = card ? fx.elCenter(card) : null;
  } else if (ev.cell != null) {
    from = fx.cellCenter(ev.cell);
  }
  if (!from) { const b = document.querySelector('.battle'); const c = b ? fx.elCenter(b) : null; if (c) from = c; }
  if (!from) return;

  // Layer A — a small gather flash at the source.
  setTimeout(() => fx.impact(from.x, from.y, { color: CC.limitFlash, r: lc.gatherFlashR }), lc.launchDelay);

  (ev.heroIds || []).forEach((hid, i) => {
    holdLimit(hid); // freeze the displayed fill until this hero's mote lands
    setTimeout(() => {
      const barEl = document.querySelector(`[data-battle-hero="${hid}"] .bar.limit`);
      if (!barEl) { landLimit(hid); return; }
      const br = barEl.getBoundingClientRect();
      const to = fx.appPt(br.left + br.width / 2, br.bottom); // dock at the BOTTOM edge of the limit bar, wherever it sits
      fx.spawnEnergyMote(from, to, {
        color: CC.limitFlash, ramp: lc.trail.ramp,
        width: lc.trail.width * lc.tier.widthMul[off], length: lc.trail.length,
        speed: lc.trail.speed, r: lc.trail.r * lc.tier.rMul[off],
        headWidthMul: lc.trail.headWidthMul, tailWidthMul: lc.trail.tailWidthMul, fadePow: lc.trail.fadePow, fadePeak: lc.trail.fadePeak,
        popOut: lc.popOut, accel: lc.accel, head: lc.head,
        onHit: (x, y) => { bof(x, y, barEl, off); landLimit(hid); },
      });
    }, lc.launchDelay + i * lc.stagger); // stagger so each hero's mote reads distinctly (L→R sweep)
  });
}
