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

// POOLED transient overlay child of the limit bar (#8): reuse <i> nodes across mote landings instead of
// creating + GC-ing 3–4 fresh nodes every landing. ovRelease clears the node (incl. any child, e.g. the
// wipe band) and returns it to the pool. The bar is position:relative, overflow:visible.
const _ovPool = [];
function ovAcquire(bar, css) {
  const el = _ovPool.pop() || document.createElement('i');
  el.style.cssText = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none;' + css;
  bar.appendChild(el);
  return el;
}
function ovRelease(el) {
  el.remove();
  el.style.cssText = ''; el.textContent = ''; // drop inline styles + any child node before reuse
  if (_ovPool.length < 24) _ovPool.push(el);
}

// The in-game bar flash — combat.limitPulse. A dramatic, SHARP multi-layer pop fired as each
// limit-energy mote lands (merge AND order): (C) sharp scale pop of the whole bar, (B) a sharp
// whole-bar white flash, (A) a bright colour WIPE sweeping across, (D) an emitted white rectangular
// shadow that scales out + fades. All params are data (_vfx.json → combat.limitPulse).
export function pulseLimitBar(bar) {
  if (!bar || !bar.animate) return;
  const p = CB.limitPulse;
  // C — SHARP scale pop: snaps to peak early, then settles.
  bar.animate(
    [{ transform: 'scale(1)', offset: 0 }, { transform: `scale(${p.scale})`, offset: p.scalePeak }, { transform: 'scale(1)', offset: 1 }],
    { duration: p.ms, easing: 'cubic-bezier(.15,.9,.25,1)' },
  );
  // B — whole-bar WHITE flash: sharp in, quick out.
  const flash = ovAcquire(bar, 'background:#fff;z-index:6;opacity:0;');
  flash.animate([{ opacity: 0 }, { opacity: p.white, offset: p.whitePeak }, { opacity: 0 }], { duration: p.ms, easing: 'ease-out' }).onfinish = () => ovRelease(flash);
  // A — colour WIPE: a bright band sweeps left→right across the bar (clipped to the bar shape).
  const clip = ovAcquire(bar, 'overflow:hidden;z-index:7;');
  const band = document.createElement('i');
  band.style.cssText = `position:absolute;top:0;bottom:0;left:0;width:55%;background:linear-gradient(90deg,transparent,${p.wipeColor},transparent);`;
  clip.appendChild(band);
  band.animate([{ transform: 'translateX(-140%)' }, { transform: 'translateX(240%)' }], { duration: p.wipeMs, easing: 'ease-out' }).onfinish = () => ovRelease(clip);
  // D — emitted white rectangular shadow: a glowing rect scales OUT while fading to 0.
  const g = p.ghost;
  const ghost = ovAcquire(bar, `background:transparent;box-shadow:0 0 10px 2px ${g.color};z-index:4;`);
  ghost.animate([{ transform: 'scale(1,1)', opacity: g.opacity }, { transform: `scale(${g.sx},${g.sy})`, opacity: 0 }], { duration: g.ms, easing: 'ease-out' }).onfinish = () => ovRelease(ghost);
}

// The READY pop — fired by LimitBar when a bar visually caps.
export function limitReadyPop(bar) {
  if (!bar) return;
  const r = CB.limitCharge.ready;
  const c = fx.elCenter(bar);
  if (c) {
    fx.impact(c.x, c.y, { tier: 'heavy', color: CC.limitFlash, r: r.impactR, shake: false });
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
  // shake:false — do NOT shake the fx canvas (it would jerk EVERY ribbon on it); the punch is the burst itself
  fx.impact(x, y, { tier: 'heavy', color: CC.limitFlash, r: baseR * lc.explode.rMul, debris: lc.explode.debris, shake: false });
  if (lc.explode.flash) fx.impact(x, y, { tier: 'normal', color: '#ffffff', r: baseR * lc.explode.rMul * 0.7, shake: false });
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
        popOut: lc.popOut, accel: lc.accel, head: lc.head, start: lc.start,
        onHit: (x, y) => { bof(x, y, barEl, off); landLimit(hid); },
      });
    }, lc.launchDelay + i * lc.stagger); // stagger so each hero's mote reads distinctly (L→R sweep)
  });
}
