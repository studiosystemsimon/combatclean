// ─────────────────────────────────────────────────────────────────────────────
// ORDER CHEST CHOREOGRAPHY (view VFX). Sequence:
//   1. Board tiles fly into the order card (done by FxLayer before this runs).
//   2. The order card FLIPS into a chest at that spot.
//   3. The chest flies straight UP off the top of the screen — IN FRONT of the heroes …
//   4. … then DESCENDS into the combat spot. The chest lives in a body-level STAGE
//      (a plain fixed div on document.body, z:30 — above the combat panel, non-React,
//      unclipped) for its whole life so it is ALWAYS visible while pelted; we fire
//      `onLanded` so the order tray realigns as the chest hits the ground.
//   5. Heroes PELT the chest with projectiles for a RARITY-scaled window (common 2s,
//      +0.5s per tier); each hit gives a very small angular WOBBLE.
//   6. The chest SMASHES with a WHITE FLASH; combat PAUSES and a gacha-style reveal
//      plays BASED ON THE RARITY (on the top overlay); contents fly to the Gear tab.
//   7. Combat RESUMES (onDone → resolveChest).
// Multiple concurrent chests fan out horizontally (they never stack).
// Feedback only — never mutates game state.
// ─────────────────────────────────────────────────────────────────────────────

import { fx } from './fx-engine.js';
import { resolve } from '../assets.js';
import { GEAR_RARITY, GEAR_RARITY_ORDER } from '../../data/gear.js';
import { playChestReveal } from './reveal-engine.js';
import { awaitClearForChest, chestStarted, chestEnded } from './cinematic.js';
import { easeInCubic, easeOutCubic, easeOutBack } from './fx-math.js';
import { REVEAL } from '../../data/config.js';

const CH = REVEAL.chest;
const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Chest pop uses a stronger overshoot than the shared default (config-tunable).
const popEase = (t) => easeOutBack(t, CH.popOvershoot);

// Deterministic transform tween via MANUAL requestAnimationFrame. The chest's position
// is ALWAYS its inline style, set every frame — never a WAAPI `fill` that can leak past
// the animation and override the landing pin. (The old WAAPI fill:'both' + cancel dance
// raced the pin and left ~30-70% of chests stranded at the off-screen staging y = -100.)
// `place(easedK, rawK)` → { x, y, extra? } in viewport px.
function tweenChest(chest, place, ms, ease) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now) => {
      if (!document.body.contains(chest)) return resolve();
      const k = Math.min(1, (now - t0) / ms);
      const p = place(ease ? ease(k) : k, k);
      chest.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%) ${p.extra || ''}`;
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function iconInto(el, a, size) {
  if (a.img) {
    const im = document.createElement('img');
    im.src = a.img;
    im.draggable = false;
    im.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    el.appendChild(im);
  } else {
    el.textContent = a.emoji;
    el.style.fontSize = `${Math.round(size * CH.iconEmojiRatio)}px`;
  }
}

// A VERY SMALL angular wobble layered ON TOP of the chest's landed transform
// (composite:add) — fired on every projectile hit.
function rattle(el) {
  try {
    el.animate(
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(5deg)' },
        { transform: 'rotate(-4deg)' },
        { transform: 'rotate(2deg)' },
        { transform: 'rotate(0deg)' },
      ],
      { duration: CH.rattleMs, easing: 'ease-out', composite: 'add' },
    );
  } catch {
    /* WAAPI composite unsupported — skip the wobble */
  }
}

// ── DEV instrumentation (rides the perf probe) ───────────────────────────────
// Track each chest's FULL post-landing lifecycle so a `P` dump shows exactly where
// and whether it's visible and, if it vanishes, WHEN and WHY (removed? off-screen?
// occluded?). Pure read-only; strip with the probe.
const chestLog = (window.__chestLog = []);
let chestSeq = 0;
function snap(chest, tag) {
  try {
    const r = chest.getBoundingClientRect();
    const cs = getComputedStyle(chest);
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const topStr = top ? (top.className ? `${top.tagName}.${String(top.className).split(' ')[0]}` : top.tagName) : '(none)';
    return {
      tag,
      inDom: document.body.contains(chest),
      parent: chest.parentElement ? (chest.parentElement.className || chest.parentElement.tagName) : '(gone)',
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      inView: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
      opacity: cs.opacity, visibility: cs.visibility, display: cs.display, zIndex: cs.zIndex,
      transform: (cs.transform || '').slice(0, 60),
      topAtCenter: topStr,
    };
  } catch (e) {
    return { tag, error: String(e).slice(0, 60) };
  }
}
function trackChest(chest, gear) {
  const rec = { id: ++chestSeq, rarity: gear.rarity, samples: [snap(chest, 'landed')] };
  chestLog.push(rec);
  while (chestLog.length > 6) chestLog.shift();
  [200, 600, 1200, 2200].forEach((ms) => setTimeout(() => rec.samples.push(snap(chest, `+${ms}ms`)), ms));
}

// Chests render in their OWN body-level STAGE — a plain DOM node appended to
// document.body, NOT a React-managed div — so React reconciliation can never remove
// them, and position:fixed on document.body is guaranteed viewport-relative and
// UNCLIPPED (no ancestor overflow/transform/contain can trap it). z:30 sits above
// the combat panel (z:20) and below the currency/reveal overlays.
let _stage = null;
function chestStage() {
  if (_stage && document.body.contains(_stage)) return _stage;
  _stage = document.createElement('div');
  _stage.className = 'chest-stage';
  Object.assign(_stage.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '30' });
  document.body.appendChild(_stage);
  return _stage;
}

// Horizontal fan so concurrent chests line up instead of stacking.
const SLOT_DX = CH.fanOffsets;
const activeSlots = [];
function claimSlot() {
  let i = 0;
  while (activeSlots[i]) i++;
  activeSlots[i] = true;
  return i;
}

// runOrderChest(chestFront, revealOverlay, gear, orderPt, { onPause, onLanded, onDone })
//   chestFront   = LEGACY/unused — chests now mount in the body-level chest STAGE (see
//                  chestStage) so React can never reconcile/clip them away
//   revealOverlay= the top layer (the rarity reveal cinematic mounts here)
//   gear         = { slot, rarity }
//   orderPt      = viewport centre of the order card (where the chest is born)
//   onPause      = dispatch pauseChest (the instant the chest pops)
//   onLanded     = dispatch fillOrderGap (the instant the chest hits the ground)
//   onDone       = dispatch resolveChest (after the reveal + fly-off)
export async function runOrderChest(chestFront, revealOverlay, gear, orderPt, { onPause, onFlipped, onLanded, onDone } = {}) {
  // The lock is released when the chest is FULLY resolved (reveal done). `started`
  // guards against decrementing on an early-return path that never claimed it.
  let started = false;
  const finish = () => { if (started) { started = false; chestEnded(); } if (onDone) onDone(); };
  if (!revealOverlay) {
    onLanded && onLanded();
    return void finish();
  }
  // Do NOT launch onto the screen while an intro is playing — wait our turn, then claim
  // the stage for the whole chest lifecycle (operator contract, cinematic.js).
  await awaitClearForChest();
  chestStarted(); started = true;

  // chestFront (the React .chest-layer) is intentionally NOT used to mount — chests
  // live in the non-React body stage so nothing can reconcile/clip them away.
  const mount = chestStage();

  const arenaEl = document.querySelector('.arena');
  const slot = claimSlot();
  const releaseSlot = () => { activeSlots[slot] = false; };
  // Safety net: free the slot even if the sequence is interrupted before the smash.
  setTimeout(releaseSlot, CH.slotSafetyMs);
  // Compute an ALWAYS-ON-SCREEN landing spot from a FRESH arena rect. The rect can be
  // transiently wrong at the instant an order resolves — a stale/bad one is exactly what
  // pinned chests at y≈-100 (off the top → "disappearing"). Clamp into the arena when it
  // reads as sanely on-screen; fall back to the viewport centre when it does NOT — so a
  // chest can never be pinned off-screen. Re-read right before the descend and at landing.
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const computeSpot = () => {
    const b = arenaEl && arenaEl.getBoundingClientRect();
    const ok = b && b.width > 40 && b.height > 40 && b.top > -40 && b.top < window.innerHeight - 60;
    const cx = ok ? b.left + b.width / 2 : window.innerWidth / 2;
    const cy = ok ? b.top + b.height / 2 : window.innerHeight * CH.fallbackY;
    const rawX = cx + SLOT_DX[slot % SLOT_DX.length];
    const [vx, vy] = CH.viewInset;
    return ok
      ? { x: clampN(rawX, b.left + CH.clampInset, b.right - CH.clampInset), y: clampN(cy, b.top + CH.clampInset, b.bottom - CH.clampInset) }
      : { x: clampN(rawX, vx, window.innerWidth - vx), y: clampN(cy, vy, window.innerHeight - vy) };
  };
  let spot = computeSpot();
  const at = (x, y, extra = '') => `translate(${x}px,${y}px) translate(-50%,-50%) ${extra}`;

  // chest DOM — the visual reflects the chest's RARITY (tier art + rarity glow).
  const chest = document.createElement('div');
  chest.className = 'combat-chest';
  chest.style.left = '0';
  chest.style.top = '0';
  const rc = GEAR_RARITY[gear.rarity]?.color;
  const chestAsset = resolve(`ui.chest.${gear.rarity}`);
  iconInto(chest, chestAsset && chestAsset.emoji ? chestAsset : resolve('ui.chest'), CH.iconSize);
  if (rc) chest.style.filter = `drop-shadow(0 6px 10px rgba(0,0,0,0.6)) drop-shadow(0 0 12px ${rc})`;
  mount.appendChild(chest);

  // 2) POP the chest in at the order spot (scale-up with a little overshoot).
  chest.style.transform = at(orderPt.x, orderPt.y, 'scale(0.5)');
  await tweenChest(chest, (e) => ({ x: orderPt.x, y: orderPt.y, extra: `scale(${0.5 + 0.5 * e})` }), CH.popMs, popEase);
  // the card has become the chest → NOW empty the order slot (it stayed full through the flip).
  onFlipped && onFlipped();

  // 3) fly straight up, off the top (combat keeps running).
  await tweenChest(chest, (e) => ({ x: orderPt.x, y: orderPt.y + (CH.offscreenY - orderPt.y) * e }), CH.upMs, easeInCubic);

  // 4) descend into the FRESH, on-screen combat spot — deterministic inline transform
  //    every frame, so it ALWAYS ends exactly at spot.y (never stranded off-screen).
  spot = computeSpot();
  await tweenChest(
    chest,
    (e, k) => ({ x: spot.x, y: CH.offscreenY + (spot.y - CH.offscreenY) * e, extra: k > 0.75 ? `scale(${1 + (1 - k) * 0.5})` : '' }),
    CH.descendMs,
    easeOutCubic,
  );

  // 5) LANDED. Motion is manual (no WAAPI fill), so the inline transform is already
  //    exactly at(spot.x, spot.y) and nothing can override it. Pin once more for safety.
  spot = computeSpot();
  chest.style.transform = at(spot.x, spot.y);

  // *** the chest has HIT THE GROUND → realign the order tray now ***
  onLanded && onLanded();

  // DEV instrumentation: track the chest's lifecycle (surfaced in the `P` dump).
  trackChest(chest, gear);

  // 5) heroes PELT the chest with projectiles for a RARITY-scaled window (common 2s,
  //    +0.5s per tier); each hit gives a very small angular WOBBLE.
  const ap = fx.appPt(spot.x, spot.y);
  const tier = Math.max(0, GEAR_RARITY_ORDER.indexOf(gear.rarity)); // canonical ladder (no local copy)
  const HIT_WINDOW = CH.hitWindowBaseMs + tier * CH.hitWindowPerTierMs; // 2s, 2.5s, 3s, 3.5s, 4s
  const SHOT_MS = CH.shotMs;
  let elapsed = 0;
  let k = 0;
  while (elapsed < HIT_WINDOW) {
    const els = Array.from(document.querySelectorAll('[data-battle-hero]'));
    const el = els.length ? els[k % els.length] : null;
    k += 1;
    if (el) {
      const from = fx.elCenter(el);
      if (from) {
        fx.spawnTrail(from, ap, {
          ...CH.peltTrail,
          onHit: (x, y) => {
            fx.impact(x, y, { tier: 'normal', color: CH.peltImpactColor, r: CH.peltImpactR });
            rattle(chest); // very small angular wobble on each hit
          },
        });
      }
    }
    await wait(SHOT_MS);
    elapsed += SHOT_MS;
  }

  // 6) SMASH → white flash + burst, then the reveal.
  fx.flash(CH.smashFlash.opacity, CH.smashFlash.ms, CH.smashFlash.color);
  fx.impact(ap.x, ap.y, { tier: 'crit', color: CH.smashFlash.color, r: CH.smashImpactR });
  chest.remove();
  releaseSlot();

  // 6-7) PAUSE combat, run the rarity reveal on the TOP overlay, then resume.
  onPause && onPause();
  const navGear = document.querySelector('[data-nav="gear"]');
  const flyTo = navGear ? centerOf(navGear) : null;
  playChestReveal(
    revealOverlay,
    {
      rarity: gear.rarity,
      rewardAsset: resolve(`gear.${gear.slot}`),
      rarityColor: GEAR_RARITY[gear.rarity]?.color || '#fff',
      focal: spot,
      flyTo,
    },
    finish,
  );
}
