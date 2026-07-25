// ─────────────────────────────────────────────────────────────────────────────
// INTRO DIRECTOR (view layer). Plays the LEVEL / AREA / BOSS intro cinematics over
// the real combat panel (the .intro-layer overlay + the live enemy chips), then
// tells the controller to begin combat (actions.startCombat). Ported from
// docs/mockups/intros.html — same serialized director (one run at a time, tracked
// anims + cancellable sleeps, clean teardown between runs), adapted to reveal the
// REAL React-rendered enemy chips instead of building its own.
//
// Coordination (cinematic.js): an intro WAITS for every chest to resolve before it
// starts; while an intro plays, chests wait to launch. Pure presentation.
// ─────────────────────────────────────────────────────────────────────────────

import { fx } from './fx-engine.js';
import { resolve } from '../assets.js';
import { STRINGS } from '../../data/strings.js';
import { ENEMY_BY_ID } from '../../data/enemies.js';
import { zoneIndexForLevel, levelInZone, isBossLevel } from '../../model/map.js';
import { zoneForLevel } from '../../data/zones.js'; // MERGED zone (presentation: nameKey/keyArt/biome), not the logical sim selector — matches Autobattler
import { awaitClearForIntro, introStarted, introEnded, chestsBusy } from './cinematic.js';
import { ANIM } from '../../data/config.js';

const IN = ANIM.intro;
const rnd = (a, b) => a + Math.random() * (b - a);
const L = () => document.querySelector('.intro-layer');
const battleEl = () => document.querySelector('.battle');
const enemyChips = () => [...document.querySelectorAll('.enemy-row .enemy-chip')];
const bossChip = () => document.querySelector('.enemy-row .enemy-chip.boss-chip');
const minionChips = () => [...document.querySelectorAll('.enemy-row .enemy-chip:not(.boss-chip)')];
const threatFor = (level) => Math.min(IN.threatCap, zoneIndexForLevel(level) + IN.threatBase);
const bossName = (zone) => (ENEMY_BY_ID[zone.bossId]?.name || STRINGS.combat.boss).toUpperCase();
const skulls = (n) => { let s = ''; for (let i = 0; i < 5; i++) s += `<span class="sk ${i < n ? 'on' : ''}">☠</span>`; return s; };

export function introKind(level) {
  if (isBossLevel(level)) return 'boss';
  if (levelInZone(level) === 1) return 'area';
  return 'level';
}

// ── serialized run (one intro at a time; everything tracked + cancellable) ────
let curRun = null;
function newRun() {
  return {
    anims: new Set(), timers: new Set(), aborted: false,
    alive() { return !this.aborted && curRun === this; },
    sleep(d) { return new Promise((res) => { if (this.aborted) return res(); const rec = { res }; rec.t = setTimeout(() => { this.timers.delete(rec); res(); }, d); this.timers.add(rec); }); },
    anim(el, frames, opts = {}) { if (!el || !el.animate) return { finished: Promise.resolve() }; let a; try { a = el.animate(frames, opts); } catch { return { finished: Promise.resolve() }; } this.anims.add(a); if (a.finished) a.finished.catch(() => {}); return a; },
    transient(el, frames, opts) { const a = this.anim(el, frames, opts); const rm = () => el && el.remove(); if (a.finished) a.finished.then(rm, rm); else rm(); return a; },
    teardown() { this.aborted = true; this.timers.forEach((rec) => { clearTimeout(rec.t); rec.res(); }); this.timers.clear(); this.anims.forEach((a) => { try { a.cancel(); } catch { /* */ } }); this.anims.clear(); },
  };
}
function clearOverlay() {
  const layer = L();
  if (layer) { try { layer.getAnimations({ subtree: true }).forEach((a) => a.cancel()); } catch { /* */ } layer.innerHTML = ''; layer.classList.remove('on'); }
  const b = battleEl(); if (b) { try { b.getAnimations().forEach((a) => a.cancel()); } catch { /* */ } b.style.transform = ''; }
}
const setHTML = (html) => { const layer = L(); if (layer) layer.innerHTML = html; };
const el = (sel) => { const layer = L(); return layer ? layer.querySelector(sel) : null; };

// Public: called by FxLayer when battle.status becomes 'intro'.
export async function runIntro(level, startCombat) {
  if (curRun) curRun.teardown();
  clearOverlay();
  // WAIT until every chest has resolved before beginning (operator contract).
  let guard = 0; while (chestsBusy() && guard++ < 50) await awaitClearForIntro();
  introStarted();
  const run = newRun(); curRun = run;
  const layer = L(); if (layer) layer.classList.add('on');
  const zone = zoneForLevel(level);
  const kind = introKind(level);
  try {
    if (kind === 'area') { await seqArea(run, level, zone); if (run.alive()) await seqLevel(run, level, zone); }
    else if (kind === 'boss') await seqBoss(run, level, zone);
    else await seqLevel(run, level, zone);
  } catch { /* aborted */ }
  introEnded();
  // Cancel the run's tracked anims (incl. the fill:'both' enemy-reveal ones on the real
  // chips) so combat's realign FLIP isn't fought by a leftover transform. The director
  // leaves each chip's inline visibility:visible in place (not an anim), so they stay up.
  run.teardown();
  curRun = null;
  clearOverlay();
  if (typeof startCombat === 'function') startCombat();
}

// Public: static boss GATE danger panel (battle.status === 'gate'). Chips are shown
// concealed (silhouette + ?) by the Autobattler/CSS; this adds the warning panel.
export function showGate(level) {
  if (curRun) { curRun.teardown(); curRun = null; }
  clearOverlay();
  const layer = L(); if (!layer) return;
  layer.classList.add('on');
  const zone = zoneForLevel(level); const t = threatFor(level);
  setHTML(`<div class="intro-veil gate"></div>
    <div class="gate-top"><div class="gate-warn">${STRINGS.combat.bossAhead}</div>
      <div class="gate-name">${STRINGS.combat.unknownName}</div>
      <div class="skulls">${skulls(t)}</div>
      <div class="threat">${STRINGS.combat.threat}: ${STRINGS.combat.threatLabels[t]}</div></div>`);
}

// Public: tear the overlay down (any non-intro/non-gate status).
export function clearIntro() { if (curRun) { curRun.teardown(); curRun = null; } clearOverlay(); }

/* ══ LEVEL ═══════════════════════════════════════════════════════════════════ */
async function seqLevel(run, level, zone) {
  setHTML(`<div class="intro-veil"></div>
    <div class="intro-flash"></div>
    <div class="intro-stack"><div class="lvl-word">${STRINGS.combat.introLevel}</div>
      <div class="intro-title lvl-num">${level}</div>
      <div class="intro-sub">◈ ${STRINGS.zones[zone.nameKey]}</div></div>`);
  run.anim(el('.intro-veil'), [{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'forwards' });
  run.anim(el('.lvl-word'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 0.9, transform: 'translateY(0)' }], { duration: 260, fill: 'both' });
  run.anim(el('.lvl-num'), [{ opacity: 0, transform: 'scale(1.8)', filter: 'blur(8px)' }, { opacity: 1, transform: 'scale(.94)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,1.3,.3,1)', fill: 'both' });
  await run.sleep(120); if (!run.alive()) return;
  run.anim(el('.intro-flash'), [{ opacity: 0.5 }, { opacity: 0 }], { duration: 320 });
  run.anim(el('.intro-sub'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 200, fill: 'both' });
  await run.sleep(560); if (!run.alive()) return;
  // reveal the REAL enemy chips one by one (they're visibility:hidden via CSS in intro)
  for (const chip of enemyChips()) {
    if (!run.alive()) return;
    chip.style.visibility = 'visible';
    const art = chip.querySelector('.chip-art');
    if (art) { const glow = document.createElement('div'); glow.className = 'summon-glow'; art.appendChild(glow);
      run.transient(glow, [{ opacity: 0, transform: 'translateX(-50%) scale(.4)' }, { opacity: 1, transform: 'translateX(-50%) scale(1.2)', offset: 0.4 }, { opacity: 0, transform: 'translateX(-50%) scale(1.6)' }], { duration: 520 }); }
    run.anim(chip, [{ opacity: 0, transform: 'translateY(26px) scale(.4)' }, { opacity: 1, transform: 'translateY(-3px) scale(1.08)', offset: 0.6 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 480, easing: 'cubic-bezier(.2,1.2,.3,1)', fill: 'both' });
    run.anim(chip.querySelector('.lv-badge'), [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.25)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, delay: 150, easing: 'cubic-bezier(.2,1.3,.3,1)', fill: 'both' });
    await run.sleep(150);
  }
  await run.sleep(420); if (!run.alive()) return;
  // Exit: ease DOWN from the resting position and out. The stack's CSS base transform
  // is translateY(-50%) (vertical centre); the exit keyframes MUST keep that -50% or
  // the anim snaps the stack down to translateY(0) on the first frame (half its height
  // lower) before easing — the "moves down then up" glitch. Anchor at -50% → drift +44px.
  run.anim(el('.intro-stack'), [{ opacity: 1, transform: 'translateY(-50%)' }, { opacity: 0, transform: `translateY(calc(-50% + ${IN.exitDriftPx}px))` }], { duration: 340, easing: 'cubic-bezier(.4,0,.7,1)', fill: 'forwards' });
  run.anim(el('.intro-veil'), [{ opacity: 1 }, { opacity: 0 }], { duration: 340, fill: 'forwards' });
  await run.sleep(360);
}

/* ══ AREA ════════════════════════════════════════════════════════════════════ */
async function seqArea(run, level, zone) {
  const zi = zoneIndexForLevel(level) + 1;
  const artUrl = resolve(zone.keyArt)?.img;
  setHTML(`<div class="area-art" ${artUrl ? `style="background-image:url(${artUrl})"` : ''}></div>
    <div class="area-wash"></div>
    <div class="intro-veil"></div>
    <div class="lb-bar t"></div><div class="lb-bar b"></div>
    <div class="intro-flash"></div>
    <div class="intro-stack"><div class="intro-kick">${STRINGS.combat.introZone} ${zi}</div>
      <div class="intro-title area-name">${(STRINGS.zones[zone.nameKey] || '').toUpperCase()}</div></div>`);
  run.anim(el('.lb-bar.t'), [{ height: '0' }, { height: '30px' }], { duration: 360, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
  run.anim(el('.lb-bar.b'), [{ height: '0' }, { height: '30px' }], { duration: 360, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
  run.anim(el('.intro-veil'), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'forwards' });
  run.anim(el('.area-art'), [{ opacity: 0, transform: 'scale(1.18)', clipPath: 'inset(0 100% 0 0)' }, { opacity: 0.55, transform: 'scale(1.08)', clipPath: 'inset(0 0 0 0)', offset: 0.7 }, { opacity: 0.42, transform: 'scale(1.03)' }], { duration: 900, easing: 'cubic-bezier(.2,.6,.2,1)', fill: 'forwards' });
  run.anim(el('.area-wash'), [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0.5 }], { duration: 900, fill: 'forwards' });
  run.anim(el('.intro-flash'), [{ opacity: 0 }, { opacity: 0.35, offset: 0.2 }, { opacity: 0 }], { duration: 700 });
  await run.sleep(360); if (!run.alive()) return;
  run.anim(el('.intro-kick'), [{ opacity: 0, letterSpacing: '12px' }, { opacity: 1, letterSpacing: '5px' }], { duration: 420, fill: 'both' });
  await run.sleep(160); if (!run.alive()) return;
  run.anim(el('.area-name'), [{ opacity: 0, transform: 'scale(1.4)', filter: 'blur(10px)' }, { opacity: 1, transform: 'scale(.97)', offset: 0.65 }, { opacity: 1, transform: 'scale(1)' }], { duration: 560, easing: 'cubic-bezier(.2,1.2,.3,1)', fill: 'both' });
  run.anim(el('.intro-flash'), [{ opacity: 0.55 }, { opacity: 0 }], { duration: 420 });
  const b = battleEl(); run.anim(b, [{ transform: 'translate(0,0)' }, { transform: 'translate(-3px,2px)' }, { transform: 'translate(3px,-2px)' }, { transform: 'translate(0,0)' }], { duration: 260 });
  const layer = L();
  for (let i = 0; i < IN.moteCount; i++) { if (!layer) break; const m = document.createElement('div'); m.className = 'area-mote'; m.style.left = `${rnd(6, 94)}%`; layer.appendChild(m);
    run.transient(m, [{ transform: 'translateY(0)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: `translate(${rnd(-16, 16)}px,-${rnd(120, 220)}px)`, opacity: 0 }], { duration: rnd(1800, 3200), easing: 'ease-out', delay: i * 70 }); }
  await run.sleep(3700); if (!run.alive()) return;           // hold the area name a good beat
  run.anim(el('.intro-stack'), [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
  run.anim(el('.area-art'), [{ opacity: 0.42 }, { opacity: 0 }], { duration: 360, fill: 'forwards' });
  run.anim(el('.area-wash'), [{ opacity: 0.5 }, { opacity: 0 }], { duration: 360, fill: 'forwards' });
  run.anim(el('.lb-bar.t'), [{ height: '30px' }, { height: '0' }], { duration: 340, delay: 120, fill: 'forwards' });
  run.anim(el('.lb-bar.b'), [{ height: '30px' }, { height: '0' }], { duration: 340, delay: 120, fill: 'forwards' });
  await run.sleep(560);
  // NOTE: do NOT clearOverlay() here — seqLevel runs next and replaces the overlay
  // content via setHTML; clearing would drop the .on class and render it invisible.
}

/* ══ BOSS ════════════════════════════════════════════════════════════════════ */
async function seqBoss(run, level, zone) {
  const t = threatFor(level);
  setHTML(`<div class="intro-veil gate"></div><div class="intro-flash"></div>
    <div class="gate-top" id="gt"><div class="gate-warn">${STRINGS.combat.bossAhead}</div>
      <div class="gate-name">${STRINGS.combat.unknownName}</div>
      <div class="skulls">${skulls(t)}</div>
      <div class="threat">${STRINGS.combat.threat}: ${STRINGS.combat.threatLabels[t]}</div></div>`);
  run.anim(el('.intro-veil'), [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
  const boss = bossChip(); const bossImg = boss?.querySelector('.chip-art');
  const minis = minionChips();
  // 1) dread build — lightning stabs + the silhouette swells
  run.anim(el('#gt'), [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 200, fill: 'forwards' });
  for (let i = 0; i < 3; i++) run.anim(el('.intro-flash'), [{ opacity: 0 }, { opacity: 0.8, offset: 0.1 }, { opacity: 0, offset: 0.3 }, { opacity: 0.5, offset: 0.5 }, { opacity: 0 }], { duration: 420, delay: 300 + i * 220 });
  if (bossImg) run.anim(bossImg, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }], { duration: 800, easing: 'ease-in', fill: 'forwards' });
  await run.sleep(1000); if (!run.alive()) return;
  // 2) the "?" SHATTERS + a big flash → boss REVEALED (silhouette → colour)
  [boss, ...minis].forEach((c) => { const q = c?.querySelector('.conceal-q'); if (q) { const qa = run.anim(q, [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.8)', offset: 0.4 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(3)' }], { duration: 360, easing: 'ease-in' }); if (qa.finished) qa.finished.then(() => { q.style.visibility = 'hidden'; }, () => {}); } });
  await run.sleep(240); if (!run.alive()) return;
  run.anim(el('.intro-flash'), [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], { duration: 620 });
  const b = battleEl(); run.anim(b, [{ transform: 'translate(0,0)' }, { transform: 'translate(-5px,3px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(0,0)' }], { duration: 500 });
  // reveal each concealed chip's art (WAAPI filter overrides the CSS silhouette)
  const reveal = (c, i) => { const im = c?.querySelector('.chip-art .art-img') || c?.querySelector('.chip-art .art-emoji'); if (!im) return;
    run.anim(im, [{ filter: 'brightness(0) saturate(0)' }, { filter: 'brightness(1.6) saturate(1.2)', offset: 0.3 }, { filter: 'brightness(1) saturate(1)' }], { duration: 700, delay: i * 70, fill: 'forwards' }); };
  reveal(boss, 0); minis.forEach((mn, i) => reveal(mn, i + 1));
  if (bossImg) run.anim(bossImg, [{ transform: 'scale(1.12)' }, { transform: 'scale(1.26)', offset: 0.3 }, { transform: 'scale(1.16)' }], { duration: 600, easing: 'cubic-bezier(.2,1.2,.3,1)', fill: 'forwards' });
  await run.sleep(560); if (!run.alive()) return;
  // 3) NAME SLAM + difficulty meter
  setHTML(`<div class="intro-veil gate" style="opacity:1"></div>
    <div class="gate-top" id="gt"><div class="gate-warn reveal">${STRINGS.combat.bossReveal}</div>
      <div class="gate-name" id="bn">${bossName(zone)}</div>
      <div class="dmeter"><i id="dm"></i></div>
      <div class="threat" id="th">${STRINGS.combat.threat}: <b>${STRINGS.combat.threatLabels[t]}</b> &nbsp; ${skulls(t)}</div></div>`);
  run.anim(el('#gt'), [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'both' });
  run.anim(el('#bn'), [{ opacity: 0, transform: 'scale(1.5)', filter: 'blur(8px)' }, { opacity: 1, transform: 'scale(.96)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.2,1.3,.3,1)', fill: 'both' });
  run.anim(el('#dm'), [{ width: '0' }, { width: `${t * 20}%` }], { duration: 700, delay: 300, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
  run.anim(el('#th'), [{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 420, fill: 'both' });
  await run.sleep(2000); if (!run.alive()) return;
  // 4) settle → combat (the Autobattler drops .concealed on 'fighting', so the boss
  //    art + Lv badges appear exactly as the fight begins)
  run.anim(el('#gt'), [{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
  run.anim(el('.intro-veil'), [{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' });
  await run.sleep(520);
}
