// ─────────────────────────────────────────────────────────────────────────────
// FX COORDINATOR (view layer). Drains the controller's pure-data `fx` queue:
//   • heroAttacks  → small weapon trail from each living hero to the front enemy.
//   • orderChest   → tiles smash into the order, which converts to a chest that
//                    flies up, descends into combat, smashes, reveals its GEAR
//                    (flash from white), and flies to the Gear nav tab; then
//                    combat resumes (resolveChest).
//   • levelComplete→ the won hero-XP / gear-XP / coins fly to the currency bars.
//   • limitBreak   → a crit-tier impact across the enemy line.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useGame } from '../controller/GameContext';
import FxCanvas from './fx/FxCanvas.jsx';
import { fx } from './fx/fx-engine.js';
import { currencyBurst } from './fx/currency-pickup.js';
import { runOrderChest } from './fx/chest-smash.js';
import { playGachaReveal } from './fx/gacha-reveal.js';
import { startPerfProbe } from './fx/perf-probe.js';
import { runIntro, showGate, clearIntro } from './fx/intro-director.js';
import { resolve } from './assets.js';
import { hapticForFx } from './haptics.js';
import { STRINGS } from '../data/strings.js';
import { LEVEL_SCALING } from '../data/enemies.js';
import { VFX_CONFIG } from '../data/config.js';

// Boss telegraph VFX duration = the model's telegraph window, read straight from
// config. Sim time = real time, so bossTelegraphMs is already real ms — no conversion.
const TELEGRAPH_MS = LEVEL_SCALING.bossTelegraphMs;
const bossFxLayer = () => document.querySelector('.battle-fx');

// A gacha reveal owns the full-screen `.reveal-overlay` while it plays; guard
// against overlapping reveals on the same mount (the screen also gates re-pulls).
let gachaActive = false;

// Weapon-trail + impact colours come from central config (VFX_CONFIG), not inlined.
const TRAIL_BY_CHAIN = VFX_CONFIG.trailByChain;
const IMPACT_COLOR = VFX_CONFIG.impactColor;
const CC = VFX_CONFIG.combatColors; // combat-special VFX colours (central config)
const CB = VFX_CONFIG.combat; // per-effect combat VFX tuning (central config)
const rectCenter = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

// The per-hit enemy reaction, fired on EVERY landed hit (basic or special):
//   • a quick WHITE flash on the sprite (even the super-quick ones read), and
//   • the ACTUAL enemy chip SHAKES — a small jitter local to that chip (this is
//     the sprite-level shake; the reduced screen shake stays specials-only).
function flashChip(el) {
  if (!el) return;
  const art = (el.querySelector && el.querySelector('.chip-art')) || el;
  if (art.animate) {
    // flash (filter) + shake (transform) BOTH on the sprite (.chip-art) — separate
    // properties so they coexist, and off the chip element so the realign FLIP
    // (which transforms the chip) never fights the hit shake.
    // brightness-ONLY flash: a compositor-friendly colour-matrix op, no per-frame
    // GPU blur pass (an animated drop-shadow was the expensive part). Pushed to 4×
    // so the sprite still blows toward white on the hit — the flash still reads.
    art.animate(
      [
        { filter: 'brightness(1)' },
        { filter: `brightness(${CB.hitFlash.brightness})`, offset: CB.hitFlash.peakOffset },
        { filter: 'brightness(1)' },
      ],
      { duration: CB.hitFlash.ms, easing: 'ease-out' },
    );
    art.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: 'translate(-3px,2px)' },
        { transform: 'translate(3px,-2px)' },
        { transform: 'translate(-2px,1px)' },
        { transform: 'translate(0,0)' },
      ],
      { duration: CB.chipShake.ms, easing: 'ease-out' },
    );
  }
}

// FrogGame-style death-dissolve accent: a puff of WHITE dust at the dying enemy's
// sprite centre. The `.enemy-chip.dead` CSS decay carries the white-out + fade;
// this adds the dust that sells the dissolve.
function deathDust(uid) {
  const el = document.querySelector(`[data-battle-enemy="${uid}"]`);
  if (!el) return;
  const art = el.querySelector('.chip-art') || el;
  const c = fx.elCenter(art);
  if (c) fx.impact(c.x, c.y, { tier: 'normal', color: CC.deathDust, r: CB.deathDust.r });
}

// A LIGHT shake confined to the combat ARENA only (never the full-screen fx.shake).
function shakeArena(amp = CB.arenaShake.amp) {
  const arena = document.querySelector('.arena');
  if (!arena || !arena.animate) return;
  arena.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${-amp}px,${amp * 0.5}px)` },
      { transform: `translate(${amp}px,${-amp * 0.5}px)` },
      { transform: `translate(${-amp * 0.5}px,${amp * 0.4}px)` },
      { transform: 'translate(0,0)' },
    ],
    { duration: CB.arenaShake.ms, easing: 'ease-out' },
  );
}

// White "taking damage" flash on the order card as board items slam into it.
function flashCard(card) {
  if (!card) return;
  try {
    card.animate(
      // brightness-only (no animated drop-shadow blur) — cheaper, reads the same.
      [{ filter: `brightness(${CB.cardFlash.brightness})` }, { filter: 'brightness(1)' }],
      { duration: CB.cardFlash.ms, easing: 'ease-out' },
    );
  } catch {
    /* ignore */
  }
}

// Actor telegraph: the attacking chip lunges forward + brightens for 200ms BEFORE
// its trail fires, so a glance can see WHO is attacking. hostile=true tints it red.
function telegraphChip(el, hostile) {
  const art = (el && el.querySelector && el.querySelector('.chip-art')) || el;
  if (!art || !art.animate) return;
  art.animate(
    [
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: `scale(${CB.telegraph.scale})`, filter: hostile ? `brightness(${CB.telegraph.hostileBrightness}) saturate(${CB.telegraph.hostileSaturate})` : `brightness(${CB.telegraph.brightness})`, offset: CB.telegraph.offset },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ],
    { duration: CB.telegraph.ms, easing: 'ease-out' },
  );
}

function handleHeroAttacks(ev) {
  const enemyEl = document.querySelector(`[data-battle-enemy="${ev.targetUid}"]`);
  const artEl = enemyEl && (enemyEl.querySelector('.chip-art') || enemyEl);
  const to = artEl ? fx.elCenter(artEl) : null;
  const basics = ev.basics || [];
  // Each hero whose OWN cadence fired this tick registers INDIVIDUALLY: telegraph →
  // trail → impact → its own damage number on the target. Staggered so multiple
  // same-tick shots each read.
  basics.forEach((h, i) => {
    const heroEl = document.querySelector(`[data-battle-hero="${h.id}"]`);
    if (!heroEl || !to) return;
    const from = fx.elCenter(heroEl);
    const t = TRAIL_BY_CHAIN[h.weapon] || {};
    const base = i * CB.heroAttack.stagger;
    setTimeout(() => telegraphChip(heroEl), base); // WHO is attacking: the chip lunges + brightens
    setTimeout(
      () =>
        fx.spawnTrail(from, to, {
          ...t, speed: CB.heroAttack.trailSpeed, r: CB.heroAttack.trailR, // width/length from trailByChain
          onHit: () => {
            fx.impact(to.x, to.y, { tier: h.crit ? 'heavy' : 'normal', color: IMPACT_COLOR[h.weapon], r: h.crit ? CB.heroAttack.impactCrit : CB.heroAttack.impactNormal });
            flashChip(enemyEl);
            if (enemyEl) spawnNumber(enemyEl, h.dmg, h.crit ? 'crit' : 'enemy'); // THIS hero's own hit
          },
        }),
      base + CB.heroAttack.trailDelay,
    );
  });
  // A hero SPECIAL (normal ability) landed this tick → the light, combat-local shake.
  if (ev.firedNormals?.length) shakeArena();
  // Splash / ability damage numbers on the OTHER enemies. The focused target's number
  // is already shown per-hero above when a basic hit it — only fall back to the
  // aggregate there when no basic landed this tick.
  const basicHitTarget = basics.length > 0;
  (ev.enemyDamage || []).forEach((d) => {
    if (d.uid === ev.targetUid && basicHitTarget) return;
    const el = document.querySelector(`[data-battle-enemy="${d.uid}"]`);
    if (el) setTimeout(() => spawnNumber(el, d.amount, 'enemy'), CB.heroAttack.splashDelay);
  });
  // enemies that died this tick → white death-dust (the CSS decay does the dissolve)
  (ev.enemyDeaths || []).forEach((uid) => setTimeout(() => deathDust(uid), CB.heroAttack.deathDustDelay));
  (ev.heals || []).forEach((h) => {
    const el = document.querySelector(`[data-battle-hero="${h.heroId}"]`);
    if (el) spawnNumber(el, h.amount, 'heal');
  });
  if (ev.crit) { combo(STRINGS.combat.critical); shakeArena(CB.heroAttack.critShake); }
}

// A completed order charges every squad hero's LIMIT BREAK — make it VISIBLE:
// gold energy motes stream from the fulfilled order card into each hero's limit
// bar, which pulses on arrival. Fires alongside the orderChest sequence.
function pulseLimitBar(bar) {
  if (!bar || !bar.animate) return;
  bar.animate(
    [
      { filter: 'brightness(1)', transform: 'scale(1)' },
      { filter: `brightness(${CB.limitPulse.brightness})`, transform: `scale(${CB.limitPulse.scale})`, offset: CB.limitPulse.offset },
      { filter: 'brightness(1)', transform: 'scale(1)' },
    ],
    { duration: CB.limitPulse.ms, easing: 'ease-out' },
  );
}
function handleLimitCharge(ev) {
  // Source: the fulfilled order card (still in the DOM, marked fulfilling). Fallback
  // to the top of the combat panel if the card can't be found.
  const card = ev.orderId != null
    ? Array.from(document.querySelectorAll('.orders .order')).find((c) => c.getAttribute('data-order-id') === String(ev.orderId))
    : null;
  let from = card ? fx.elCenter(card) : null;
  if (!from) {
    const b = document.querySelector('.battle');
    const c = b ? fx.elCenter(b) : null;
    if (c) from = { x: c.x, y: c.y };
  }
  if (!from) return;
  (ev.heroIds || []).forEach((hid, i) => {
    const bar = document.querySelector(`[data-battle-hero="${hid}"] .bar.limit`);
    if (!bar) return;
    const to = fx.elCenter(bar);
    if (!to) return;
    setTimeout(() => {
      fx.spawnTrail(from, to, {
        color: CC.limitFlash, tail: CC.limitBreak, ...CB.limitCharge.trail,
        onHit: (x, y) => { fx.impact(x, y, { tier: 'normal', color: CC.limitFlash, r: CB.limitCharge.impactR }); pulseLimitBar(bar); },
      });
    }, i * CB.limitCharge.stagger); // stagger so each hero's mote reads distinctly
  });
}

function handleOrderChest(ev, chestLayer, overlay, { pauseChest, resolveChest, emptyOrder }) {
  const cards = document.querySelectorAll('.orders .order');
  const card = Array.from(cards).find((c) => c.getAttribute('data-order-id') === String(ev.orderId));
  const orderPt = card ? fx.elCenter(card) : null; // app coords (canvas trails)
  const orderVp = card ? rectCenter(card) : { x: window.innerWidth / 2, y: window.innerHeight * CB.orderChest.fallbackY };
  // 1) board tiles fly into the order card
  ev.items.forEach((it, i) => {
    const from = fx.cellCenter(it.cell);
    if (!from || !orderPt) return;
    const t = TRAIL_BY_CHAIN[it.chain] || {};
    setTimeout(
      () =>
        fx.spawnTrail(from, orderPt, {
          ...t, speed: CB.orderChest.trailSpeed,
          onHit: (x, y) => { fx.impact(x, y, { tier: 'normal', color: IMPACT_COLOR[it.chain], r: CB.orderChest.impactR }); flashCard(card); },
        }),
      i * CB.orderChest.tileStagger,
    );
  });
  // 2-8) card flips to chest → flies up → descends into combat (combat live) →
  // heroes cosmetic-attack it → pops → PAUSE → rarity reveal → contents fly to the
  // Gear tab as the reveal shrinks → RESUME + fill the order gap.
  const delay = CB.orderChest.baseDelay + ev.items.length * CB.orderChest.tileStagger;
  setTimeout(
    () =>
      runOrderChest(chestLayer, overlay, ev.gear, orderVp, {
        onPause: pauseChest,
        // Card stayed full through the slam; on flip the order DISAPPEARS and a pending
        // arrival timer is appended at the end (EMPTY_ORDER). The replacement is rolled
        // by that timer (Orders.jsx → FILL_ORDER_GAP), NOT on chest landing.
        onFlipped: () => emptyOrder(ev.orderId),
        onDone: resolveChest,
      }),
    delay,
  );
}

// Merge VISUALS are owned by the merge board itself (src/view/Board.jsx), which
// drives the full slam → squash → birth sequence and fires the shared fx engine
// directly. The reducer emits a HAPTIC-ONLY 'merge' fx event — the drain loop below
// routes it to hapticForFx — and there is deliberately NO visual merge handler here
// (a second merge-VFX path would be a forbidden parallel workflow).

// Wave/level cleared → a short centred beat BEFORE the COMPLETE banner, so a
// distracted player registers "I won that" even at a glance.
function handleWaveClear() {
  const arena = document.querySelector('.enemy-row') || document.querySelector('.arena');
  if (arena) { const c = fx.elCenter(arena); if (c) fx.impact(c.x, c.y, { tier: 'heavy', color: CC.waveClear, r: CB.waveClear.impactR, shake: false }); }
  combo(STRINGS.combat.waveClear);
  shakeArena(CB.waveClear.shake);
}

function handleLevelComplete(ev) {
  const from = { x: window.innerWidth / 2, y: window.innerHeight * CB.levelComplete.originY };
  const items = [];
  if (ev.coins) items.push({ ...resolve('ui.coin'), statKey: 'coins', amount: ev.coins, color: CC.currencyCoin });
  if (ev.heroXp) items.push({ ...resolve('ui.heroXp'), statKey: 'heroXp', amount: ev.heroXp, color: CC.currencyHeroXp });
  if (ev.gearXp) items.push({ ...resolve('ui.gearXp'), statKey: 'gearXp', amount: ev.gearXp, color: CC.currencyGearXp });
  currencyBurst(from, items);
  // CONFETTI finale — one lean central erupt (kept small so it doesn't fight the
  // currency burst for frame budget at level-complete).
  const COLORS = VFX_CONFIG.confettiColors;
  const { levelComplete: LC, fallbackCanvas: FBC } = CB;
  const W = fx.W || FBC.w;
  const H = fx.H || FBC.h;
  fx.confetti(W * LC.confettiX, H * LC.confettiY, { colors: COLORS, count: LC.confettiCount });
  fx.flash(LC.flashOpacity, LC.flashMs);
}

function handleLimitBreak(ev) {
  const arena = document.querySelector('.enemy-row') || document.querySelector('.arena');
  if (arena) {
    const c = fx.elCenter(arena);
    fx.impact(c.x, c.y, { tier: 'crit', color: CC.limitBreak, r: CB.limitBreak.impactR });
  }
  document.querySelectorAll('[data-battle-enemy]').forEach(flashChip); // a limit break flashes EVERY enemy
  shakeArena(CB.limitBreak.arenaShake); // its a special → the arena shakes (combat-local, still light)
  (ev.enemyDeaths || []).forEach((uid) => setTimeout(() => deathDust(uid), CB.limitBreak.deathDustDelay)); // dissolve dust for the slain
  // full cinematic: white/gold flash overlay + golden beam sweep + LIMIT BREAK! text + big shake
  const cine = document.querySelector('.lb-cine');
  if (cine) {
    cine.animate([{ opacity: 0 }, { opacity: 1, offset: CB.limitBreak.cineOffset }, { opacity: 0 }], { duration: CB.limitBreak.cineMs, easing: 'ease-out' });
    const beam = cine.querySelector('.beam');
    if (beam) {
      const sk = `translateY(-50%) skewY(${CB.limitBreak.beamSkew}deg)`;
      beam.animate(
        [{ transform: `${sk} scaleX(0)` }, { transform: `${sk} scaleX(1)` }],
        { duration: CB.limitBreak.beamMs, easing: 'ease-out' },
      );
    }
  }
  combo(STRINGS.combat.limitBreak);
  fx.flash(CB.limitBreak.flashOpacity, CB.limitBreak.flashMs, CC.limitFlash);
  fx.shake(CB.limitBreak.screenShake);
  (ev?.enemyDamage || []).forEach((d) => {
    const el = document.querySelector(`[data-battle-enemy="${d.uid}"]`);
    if (el) spawnNumber(el, d.amount, 'crit');
  });
  (ev?.heals || []).forEach((h) => {
    const el = document.querySelector(`[data-battle-hero="${h.heroId}"]`);
    if (el) spawnNumber(el, h.amount, 'heal');
  });
}

// A gacha pull reveal: the full-screen cinematic plays on the SAME `.reveal-overlay`
// the chest uses. Combat keeps running behind it (NOT paused). The overlay is
// pointer-events:none by default → flip it to `auto` so the reveal captures taps
// (tap-to-continue / SKIP / summary), then restore it when the reveal is dismissed.
function handleGachaReveal(ev, overlay) {
  if (!overlay || gachaActive || !ev.results || !ev.results.length) return;
  gachaActive = true;
  overlay.style.pointerEvents = 'auto';
  playGachaReveal(overlay, ev, () => {
    overlay.style.pointerEvents = '';
    gachaActive = false;
  });
}

function handleEnemyAttacks(ev) {
  ev.hits.forEach((hit, i) => {
    const enemyEl = document.querySelector(`[data-battle-enemy="${hit.enemyUid}"]`);
    const heroEl = document.querySelector(`[data-battle-hero="${hit.heroId}"]`);
    if (!enemyEl || !heroEl) return;
    const from = fx.elCenter(enemyEl);
    const to = fx.elCenter(heroEl);
    const base = i * CB.enemyAttack.stagger;
    setTimeout(() => telegraphChip(enemyEl, true), base); // WHICH enemy is attacking (red tint)
    setTimeout(
      () =>
        fx.spawnTrail(from, to, {
          color: CC.enemyTrail, tail: CC.enemyTail, ...CB.enemyAttack.trail,
          onHit: (x, y) => fx.impact(x, y, { tier: 'normal', color: CC.enemyImpact, r: CB.enemyAttack.impactR }),
        }),
      base + CB.enemyAttack.trailDelay,
    );
    if (hit.dmg) {
      const el = document.querySelector(`[data-battle-hero="${hit.heroId}"]`);
      if (el) setTimeout(() => spawnNumber(el, hit.dmg, 'hero'), base + CB.enemyAttack.hurtDelay); // hero takes damage → gold
    }
  });
}

// Battle-relative centre of a DOM element (for the in-panel DOM overlay VFX,
// distinct from fx.elCenter which returns app/canvas coords).
function battleCenter(el) {
  const b = document.querySelector('.battle');
  if (!b) return null;
  const r = el.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  return { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2, battle: b };
}

// Floating damage/heal number in the .battle-fx overlay (safe from React reconciliation).
// kind: '' = normal (gold), 'crit' = big red, 'heal' = green.
function spawnNumber(el, amount, kind) {
  const overlay = bossFxLayer();
  if (!overlay || !el || !amount) return;
  const c = battleCenter(el);
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'dmg' + (kind ? ' ' + kind : '');
  d.textContent = (kind === 'heal' ? '+' : '') + Math.round(amount);
  d.style.left = c.x + 'px';
  d.style.top = c.y + 'px';
  overlay.appendChild(d);
  d.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-140%) scale(1.15)', opacity: 1, offset: 0.28 },
      { transform: 'translate(-50%,-150%) scale(1.1)', opacity: 1, offset: 0.55 }, // DWELL at peak (~250ms) so a glance catches it
      { transform: 'translate(-50%,-260%) scale(1)', opacity: 0 },
    ],
    { duration: CB.damageNumberMs, easing: 'ease-out' },
  ).onfinish = () => d.remove();
}

// Centre-screen combo popper text (CRITICAL! / LIMIT BREAK! / BOSS SLAM!).
function combo(text) {
  const c = document.querySelector('.combo');
  if (!c) return;
  c.textContent = text;
  c.animate(
    [
      { opacity: 0, transform: 'scale(.6)' },
      { opacity: 1, transform: 'scale(1.15)', offset: 0.3 },
      { opacity: 0, transform: 'scale(1)' },
    ],
    { duration: CB.comboMs, easing: 'ease-out' },
  );
}

// Combo — an enemy hit by consecutive special attacks in a row. Escalating
// "COMBO ×N" tag on that enemy (hotter + bigger as the streak grows).
function handleCombo(ev) {
  const el = document.querySelector(`[data-battle-enemy="${ev.uid}"]`);
  const overlay = bossFxLayer();
  if (!el || !overlay) return;
  const c = battleCenter(el);
  if (!c) return;
  const tag = document.createElement('div');
  tag.className = 'combo-tag';
  tag.textContent = `COMBO ×${ev.n}`;
  tag.style.left = c.x + 'px';
  const CT = CB.comboTag;
  tag.style.top = c.y - CT.yOffset + 'px';
  tag.style.fontSize = Math.min(CT.fontMax, CT.fontBase + ev.n * CT.fontPerN) + 'px';
  tag.style.color = ev.n >= CT.hotN ? CT.hotColor : ev.n >= CT.warmN ? CT.warmColor : CT.baseColor;
  overlay.appendChild(tag);
  tag.animate(
    [
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%,-120%) scale(1.2)', opacity: 1, offset: 0.3 },
      { transform: 'translate(-50%,-220%) scale(1)', opacity: 0 },
    ],
    { duration: CT.ms, easing: 'ease-out' },
  ).onfinish = () => tag.remove();
}

// Boss is about to slam: shiver the boss, flash a warning, grow a red ground ring.
function handleBossTelegraph(ev) {
  const bossEl = document.querySelector(`[data-battle-enemy="${ev.bossUid}"]`);
  if (bossEl) {
    bossEl.classList.add('telegraph');
    setTimeout(() => bossEl.classList.remove('telegraph'), TELEGRAPH_MS);
  }
  const warn = document.querySelector('.boss-warn');
  if (warn) warn.animate(
    // flash 3× (on/off/on/off/on/off) instead of one slow fade — unmissable at a glance
    [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.45 }, { opacity: 0, offset: 0.6 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
    { duration: TELEGRAPH_MS },
  );
  const overlay = bossFxLayer();
  if (!bossEl || !overlay) return;
  const c = battleCenter(bossEl);
  if (!c) return;
  const ring = document.createElement('div');
  ring.className = 'boss-tele-ring';
  const BT = CB.bossTelegraph;
  ring.style.left = c.x - BT.ringSize / 2 + 'px'; ring.style.top = c.y - BT.ringSize / 2 + 'px'; ring.style.width = ring.style.height = BT.ringSize + 'px';
  overlay.appendChild(ring); // dedicated empty overlay → safe from React reconciliation
  // Ring COLLAPSES inward (big → small) onto the boss so it reads as "impact incoming".
  ring.animate([{ transform: `scale(${BT.fromScale})`, opacity: BT.fromOpacity }, { transform: `scale(${BT.toScale})`, opacity: BT.toOpacity }], { duration: TELEGRAPH_MS, easing: 'ease-in' }).onfinish = () => ring.remove();
}

function handleBossSpecial(ev) {
  const arena = document.querySelector('.hero-row') || document.querySelector('.arena');
  if (!arena) return;
  const BS = CB.bossSpecial;
  const c = fx.elCenter(arena);
  fx.impact(c.x, c.y, { tier: 'crit', color: CC.bossImpact, r: BS.impactR });
  combo(STRINGS.combat.bossSlam);
  ev.heroIds.forEach((hid, i) => {
    const heroEl = document.querySelector(`[data-battle-hero="${hid}"]`);
    if (!heroEl) return;
    const to = fx.elCenter(heroEl);
    setTimeout(
      () =>
        fx.spawnTrail(c, to, {
          color: CC.bossTrail, tail: CC.bossImpact, ...BS.trail,
          onHit: (x, y) => fx.impact(x, y, { tier: 'heavy', color: CC.bossHitImpact, r: BS.hitR }),
        }),
      i * BS.stagger, // ≥0.1s between each hero the boss special strikes
    );
    if (ev.dmg) setTimeout(() => spawnNumber(heroEl, ev.dmg, 'crit'), i * BS.stagger + BS.numberDelay);
  });
  // Dramatic slam: red flash + extra shake, both via the EXISTING engine primitives
  // (no parallel shake/flash path); plus an expanding shockwave ring in the fx overlay.
  fx.flash(BS.flashOpacity, BS.flashMs, CC.bossFlash);
  fx.shake(BS.screenShake);
  const bossEl = ev.bossUid != null ? document.querySelector(`[data-battle-enemy="${ev.bossUid}"]`) : null;
  const overlay = bossFxLayer();
  if (bossEl && overlay) {
    const bc = battleCenter(bossEl);
    if (bc) {
      const shock = document.createElement('div');
      shock.className = 'boss-shock';
      shock.style.left = bc.x - BS.shockSize / 2 + 'px'; shock.style.top = bc.y - BS.shockSize / 2 + 'px'; shock.style.width = shock.style.height = BS.shockSize + 'px';
      overlay.appendChild(shock); // dedicated empty overlay → safe from React reconciliation
      shock.animate([{ transform: `scale(${BS.shockFromScale})`, opacity: 1 }, { transform: `scale(${BS.shockToScale})`, opacity: 0 }], { duration: BS.shockMs, easing: BS.shockCurve }).onfinish = () => shock.remove();
    }
  }
}

// Accomplices trickle-heal the boss: a faint green pulse on the boss chip + thin
// green wisps from each living accomplice into it (so the player SEES why the boss
// is regenerating → kill the adds). Fires ~1×/s while any accomplice stands.
function handleBossHeal(ev) {
  const bossEl = document.querySelector(`[data-battle-enemy="${ev.bossUid}"]`);
  if (!bossEl) return;
  const art = bossEl.querySelector('.chip-art') || bossEl;
  if (art.animate) {
    art.animate(
      // brightness-only pulse (green semantics carried by the wisp trails below) —
      // no animated drop-shadow blur.
      [
        { filter: 'brightness(1)' },
        { filter: `brightness(${CB.bossHeal.pulseBrightness})`, offset: CB.bossHeal.pulseOffset },
        { filter: 'brightness(1)' },
      ],
      { duration: CB.bossHeal.pulseMs, easing: 'ease-out' },
    );
  }
  const to = fx.elCenter(bossEl);
  if (!to) return;
  document.querySelectorAll('.enemy-chip:not(.boss-chip):not(.dead)').forEach((acc) => {
    const from = fx.elCenter(acc);
    if (from) fx.spawnTrail(from, to, { color: CC.bossHealWisp, tail: CC.bossHealTail, ...CB.bossHeal.wisp });
  });
}

// Every 3rd special the skeleton-dragon RAISES its fallen minions: a dark-magic
// cast on the boss (purple pulse + shockwave ring) then each raised minion claws
// back with a burst + rise-in pop.
function handleBossRaise(ev) {
  const BR = CB.bossRaise;
  combo(STRINGS.combat.raise);
  shakeArena(BR.arenaShake); // more theatrical so the player notices dead minions returning
  const bossEl = document.querySelector(`[data-battle-enemy="${ev.bossUid}"]`);
  if (bossEl) {
    const art = bossEl.querySelector('.chip-art') || bossEl;
    if (art.animate) {
      art.animate(
        // brightness-only cast pulse (purple semantics carried by the ring + RAISE
        // combo below) — no animated drop-shadow blur.
        [
          { filter: 'brightness(1)' },
          { filter: `brightness(${BR.castBrightness})`, offset: BR.castOffset },
          { filter: 'brightness(1)' },
        ],
        { duration: BR.castMs, easing: 'ease-out' },
      );
    }
    const overlay = bossFxLayer();
    const bc = battleCenter(bossEl);
    if (overlay && bc) {
      const ring = document.createElement('div');
      ring.className = 'boss-tele-ring';
      ring.style.left = bc.x - BR.ringSize / 2 + 'px'; ring.style.top = bc.y - BR.ringSize / 2 + 'px'; ring.style.width = ring.style.height = BR.ringSize + 'px';
      ring.style.borderColor = CC.bossRaise;
      overlay.appendChild(ring); // dedicated empty overlay → safe from React reconciliation
      ring.animate([{ transform: `scale(${BR.ringFromScale})`, opacity: BR.ringFromOpacity }, { transform: `scale(${BR.ringToScale})`, opacity: 0 }], { duration: BR.ringMs, easing: 'ease-out' }).onfinish = () => ring.remove();
    }
  }
  (ev.raised || []).forEach((uid, i) => {
    const el = document.querySelector(`[data-battle-enemy="${uid}"]`);
    if (!el) return;
    setTimeout(() => {
      const c = fx.elCenter(el);
      if (c) fx.impact(c.x, c.y, { tier: 'heavy', color: CC.bossRaise, r: BR.minionR });
      const art = el.querySelector('.chip-art') || el;
      if (art.animate) {
        art.animate(
          // brightness + scale only (purple semantics carried by the impact burst
          // above) — no animated drop-shadow blur.
          [
            { filter: `brightness(${BR.riseBrightness})`, transform: `scale(${BR.riseFromScale})` },
            { filter: 'brightness(1)', transform: 'scale(1)' },
          ],
          { duration: BR.riseMs, easing: 'cubic-bezier(.2,.8,.3,1)' },
        );
      }
    }, BR.riseBaseDelay + i * BR.riseStagger); // stagger each minion rising after the cast
  });
}

export default function FxLayer() {
  const { state, actions } = useGame();
  const overlayRef = useRef(null);
  const chestLayerRef = useRef(null);

  // DEV perf probe: press P to copy a graphical-load snapshot to the clipboard.
  useEffect(() => { startPerfProbe(); }, []);

  // Drive the level / area / boss INTRO cinematics from the battle status. On 'intro'
  // the director plays the right sequence (waiting for any chest to finish first) then
  // calls startCombat; on 'gate' it shows the boss danger panel; otherwise it clears.
  useEffect(() => {
    const st = state.battle.status;
    if (st === 'intro') runIntro(state.battle.level, actions.startCombat);
    else if (st === 'gate') showGate(state.battle.level);
    else clearIntro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.battle.status, state.battle.level]);

  useEffect(() => {
    if (!state.fx.length) return;
    const ids = state.fx.map((e) => e.id);
    for (const ev of state.fx) {
      // Haptics ride the SAME fx bus as the visuals (one owner, no parallel
      // channel). The module decides which events buzz and throttles the rest.
      hapticForFx(ev);
      if (ev.type === 'heroAttacks') handleHeroAttacks(ev);
      else if (ev.type === 'enemyAttacks') handleEnemyAttacks(ev);
      else if (ev.type === 'combo') handleCombo(ev);
      else if (ev.type === 'bossTelegraph') handleBossTelegraph(ev);
      else if (ev.type === 'bossSpecial') handleBossSpecial(ev);
      else if (ev.type === 'bossHeal') handleBossHeal(ev);
      else if (ev.type === 'bossRaise') handleBossRaise(ev);
      else if (ev.type === 'orderChest') handleOrderChest(ev, chestLayerRef.current, overlayRef.current, actions);
      else if (ev.type === 'limitCharge') handleLimitCharge(ev);
      else if (ev.type === 'waveClear') handleWaveClear();
      else if (ev.type === 'levelComplete') handleLevelComplete(ev);
      else if (ev.type === 'limitBreak') handleLimitBreak(ev);
      else if (ev.type === 'gachaReveal') handleGachaReveal(ev, overlayRef.current);
    }
    actions.clearFx(ids);
  }, [state.fx, actions]);

  return (
    <>
      {/* FRONT chest layer (fixed, ABOVE the combat panel) — the chest flies here as it
          exits/returns. On landing runOrderChest moves it into .chest-mid-layer
          (rendered inside .arena by Autobattler) so it sits IN FRONT of the enemy row
          and BEHIND the hero row. */}
      <div ref={chestLayerRef} className="chest-layer" />
      <FxCanvas />
      <div ref={overlayRef} className="reveal-overlay" />
    </>
  );
}
