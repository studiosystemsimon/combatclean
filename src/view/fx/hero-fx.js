// ─────────────────────────────────────────────────────────────────────────────
// HERO-SCREEN LEVEL-UP / EQUIP JUICE (view VFX) — DOM + Web-Animations, ported
// 1:1 from docs/mockups/hero-tiles.html (identical timings, keyframes, colours).
// Pure presentation: a fixed portal holds floats + particles that escape the
// tiles; the starburst runs INSIDE a passed clipped host so it's masked by the
// tile and sits behind the floating text. Never touches game state.
// ─────────────────────────────────────────────────────────────────────────────

import { fx } from './fx-engine.js';
import { fmtK as fmt } from '../fmt.js';
import { REVEAL } from '../../data/config.js';

const HX = REVEAL.heroFx;

let _portal = null;
function portal() {
  if (!_portal || !_portal.isConnected) { _portal = document.createElement('div'); _portal.className = 'hero-float-portal'; document.body.appendChild(_portal); }
  return _portal;
}
const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const fxHost = (el) => el.querySelector('.gfx') || (() => { const d = document.createElement('div'); d.className = 'gfx'; el.appendChild(d); return d; })();

function burstInto(host) {
  if (!host) return;
  const f = document.createElement('div'); f.className = 'lvfx-flash'; host.appendChild(f);
  f.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: HX.flashMs, easing: 'ease-out' }).onfinish = () => f.remove();
  const rays = document.createElement('div'); rays.className = 'lvfx-rays'; host.appendChild(rays);
  rays.animate([{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.4)' }, { opacity: 0.85, transform: 'translate(-50%,-50%) rotate(40deg) scale(1)', offset: 0.3 }, { opacity: 0, transform: 'translate(-50%,-50%) rotate(95deg) scale(1.3)' }], { duration: HX.raysMs, easing: 'ease-out' }).onfinish = () => rays.remove();
  for (let i = 0; i < HX.ringCount; i++) { const r = document.createElement('div'); r.className = 'lvfx-ring'; host.appendChild(r);
    r.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(5)', opacity: 0 }], { duration: HX.ringBaseMs + i * HX.ringStepMs, delay: i * HX.ringDelayMs, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => r.remove(); }
  for (let i = 0; i < HX.sparkCount; i++) { const s = document.createElement('div'); s.className = 'lvfx-spark'; host.appendChild(s);
    const a = (i / HX.sparkCount) * Math.PI * 2 + Math.random() * 0.4, d = HX.sparkDistBase + Math.random() * HX.sparkDistSpread;
    s.animate([{ transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(-50%,-50%) translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.3)`, opacity: 0 }], { duration: HX.sparkBaseMs + Math.random() * HX.sparkSpreadMs, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => s.remove(); }
}
function particleBurst(cx, cy, big) {
  const p = portal();
  const n = big ? HX.burstCount[1] : HX.burstCount[0], base = big ? HX.burstBase[1] : HX.burstBase[0], spread = big ? HX.burstSpread[1] : HX.burstSpread[0], size = big ? HX.burstSize[1] : HX.burstSize[0];
  for (let i = 0; i < n; i++) { const s = document.createElement('div'); s.className = 'pburst'; s.style.left = cx + 'px'; s.style.top = cy + 'px'; s.style.width = size + 'px'; s.style.height = size + 'px'; p.appendChild(s);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, d = base + Math.random() * spread;
    s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(-50%,-50%) translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.2)`, opacity: 0 }], { duration: (big ? HX.burstMs[1] : HX.burstMs[0]) + Math.random() * HX.burstSpreadMs, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => s.remove(); }
  if (big) { const ring = document.createElement('div'); ring.className = 'pburst-ring'; ring.style.left = cx + 'px'; ring.style.top = cy + 'px'; p.appendChild(ring);
    ring.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(10)', opacity: 0 }], { duration: HX.bigRingMs, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => ring.remove(); }
}
function floatText(x, y, text, cls, delay, dur) {
  dur = dur || HX.floatMs;
  setTimeout(() => { const d = document.createElement('div'); d.className = 'hero-float ' + cls; d.textContent = text; d.style.left = x + 'px'; d.style.top = y + 'px'; portal().appendChild(d);
    d.animate([{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 }, { transform: 'translate(-50%,-130%) scale(1.12)', opacity: 1, offset: 0.28 }, { transform: 'translate(-50%,-315%) scale(1)', opacity: 0 }], { duration: dur, easing: 'ease-out' }).onfinish = () => d.remove(); }, delay);
}
function tween(node, from, to, ms, f) {
  if (!node) return; const t0 = performance.now();
  (function step(now) { const k = Math.min(1, (now - t0) / ms); const e = 1 - (1 - k) * (1 - k); const v = Math.round(from + (to - from) * e); node.textContent = f ? f(v) : v; if (k < 1) requestAnimationFrame(step); })(t0);
  node.animate([{ transform: 'scale(1)' }, { transform: `scale(${HX.tweenScale})`, offset: 0.3 }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
}
function maxedOut(tileEl) {
  const c = centerOf(tileEl); particleBurst(c.x, c.y, true);
  const d = document.createElement('div'); d.className = 'hero-float maxed'; d.style.left = c.x + 'px'; d.style.top = (c.y - 8) + 'px'; portal().appendChild(d);
  const word = 'MAXED OUT'; let i = 0;
  const typer = setInterval(() => { i++; d.textContent = word.slice(0, i);
    d.animate([{ transform: 'translate(-50%,-50%) rotate(-4deg) scale(1.1)' }, { transform: 'translate(-50%,-50%) rotate(4deg) scale(1.02)', offset: 0.5 }, { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)' }], { duration: HX.maxedWobbleMs, easing: 'ease-out' });
    if (i >= word.length) { clearInterval(typer);
      setTimeout(() => { d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(0)', opacity: 0 }], { duration: HX.maxedExitMs, easing: 'cubic-bezier(.7,0,.84,0)' }).onfinish = () => d.remove(); }, HX.maxedHoldMs);
    }
  }, HX.maxedTyperMs);
}

// Hero level-up (single or multi). Reaching `cap` triggers MAXED OUT.
export function fxHeroLevelUp(tileEl, { fromLv, toLv, fromPow, toPow, cap }) {
  if (!tileEl) return;
  const powNode = tileEl.querySelector('.hs-pow b'), lvNode = tileEl.querySelector('.hs-lvl'), fxwrap = tileEl.querySelector('.fxwrap');
  const levels = toLv - fromLv, gain = Math.max(0, toPow - fromPow), multi = levels > 1;
  tileEl.animate([{ transform: 'scale(1)' }, { transform: `scale(${multi ? HX.tileScale[1] : HX.tileScale[0]})`, offset: 0.3 }, { transform: 'scale(.97)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: multi ? HX.tileMs[1] : HX.tileMs[0], easing: 'cubic-bezier(.2,1.4,.3,1)' });
  const g = getComputedStyle(tileEl).getPropertyValue('--rar');
  tileEl.animate([{ boxShadow: `0 0 0 0 ${g}` }, { boxShadow: `0 0 ${multi ? HX.tileGlowBlur[1] : HX.tileGlowBlur[0]}px ${multi ? HX.tileGlowSpread[1] : HX.tileGlowSpread[0]}px ${g}`, offset: 0.3 }, { boxShadow: '0 3px 9px rgba(0,0,0,.45)' }], { duration: multi ? HX.tileGlowMs[1] : HX.tileGlowMs[0], easing: 'ease-out' });
  burstInto(fxwrap);
  const c = centerOf(tileEl);
  particleBurst(c.x, c.y, multi);
  tween(powNode, fromPow, toPow, multi ? HX.powTweenMs[1] : HX.powTweenMs[0], fmt);
  if (lvNode) { tween(lvNode, fromLv, toLv, multi ? HX.lvTweenMs[1] : HX.lvTweenMs[0]); setTimeout(() => { lvNode.innerHTML = '<s>LV</s>' + toLv; }, (multi ? HX.lvTweenMs[1] : HX.lvTweenMs[0]) + 20); }
  const stats = [{ t: '+' + Math.max(1, Math.round(gain * HX.levelUpStatAtkFrac)) + ' ATK', c: 'atk' }, { t: '+' + Math.max(1, Math.round(gain * HX.levelUpStatHpFrac)) + ' HP', c: 'hp' }, { t: '+' + gain + ' PWR', c: 'pwr' }];
  if (!multi) {
    floatText(c.x, c.y - 4, 'LEVEL UP!', 'hd', 0);
    stats.forEach((s, i) => floatText(c.x + (i - 1) * 3, c.y, s.t, 'stat ' + s.c, HX.levelUpStatBaseMs + i * HX.levelUpStatDelayMs));
    if (toLv >= cap) setTimeout(() => maxedOut(tileEl), HX.maxedDelayMs);
    return;
  }
  const stagger = Math.max(HX.levelUpStaggerMin, Math.min(HX.levelUpStaggerCap, Math.round(HX.levelUpStaggerMax / levels)));
  for (let k = 0; k < levels; k++) { floatText(c.x + (Math.random() * 22 - 11), c.y, 'LEVEL UP', 'lvup', k * stagger); if (k % 3 === 0) particleBurst(c.x, c.y, false); }
  const afterTexts = levels * stagger + 150;
  stats.forEach((s, i) => floatText(c.x + (i - 1) * 3, c.y, s.t, 'stat ' + s.c, afterTexts + i * HX.levelUpStatDelayMs, HX.multiFloatDurMs)); // one total set, 1s longer
  if (toLv >= cap) setTimeout(() => maxedOut(tileEl), afterTexts + 120);
}

// Tapping an already-max hero re-shows MAXED OUT.
export function fxMaxed(tileEl) { if (tileEl) maxedOut(tileEl); }

// Gear "Level All" (+1 or Max) — the tile power tweens, and EACH equipped slot
// gets the same treatment as a hero level-up: its own power number tweens, N rapid
// "LEVEL UP" texts play for the N levels it actually gained (never "MAX"), and a
// "+X PWR" shows the real power increase.
// `entries` = [{ slotEl, fromPow, toPow, levels }].
export function fxLevelAll(tileEl, entries, fromPow, toPow) {
  if (!tileEl) return;
  tween(tileEl.querySelector('.hs-pow b'), fromPow, toPow, HX.powTweenMs[0], fmt);
  const c = centerOf(tileEl);
  particleBurst(c.x, c.y, entries.some((e) => e.levels > 1));
  entries.forEach((e, i) => setTimeout(() => {
    const s = e.slotEl;
    if (!s) return;
    s.animate([{ transform: 'scale(1)' }, { transform: `scale(${HX.slotScale})`, offset: 0.35 }, { transform: 'scale(1)' }], { duration: HX.slotMs, easing: 'cubic-bezier(.2,1.4,.3,1)' });
    burstInto(fxHost(s));
    const lv = s.querySelector('.hs-glv'); // the slot shows its LEVEL; count it up
    if (lv) tween(lv, e.fromLevel, e.toLevel, e.levels > 1 ? HX.powTweenMs[0] : HX.tileMs[0]);
    const r = centerOf(s);
    const gain = e.toPow - e.fromPow;
    if (e.levels > 1) {
      const stagger = Math.max(HX.slotStaggerMin, Math.min(HX.slotStaggerCap, Math.round(HX.slotStaggerMax / e.levels)));
      for (let k = 0; k < e.levels; k++) floatText(r.x, r.y - 6, 'LEVEL UP', 'lvup', k * stagger);
      floatText(r.x, r.y, '+' + gain + ' PWR', 'stat pwr', e.levels * stagger + 120, HX.multiFloatDurMs); // one total, held 1s longer
    } else {
      floatText(r.x, r.y, '+' + gain + ' PWR', 'stat pwr', 0);
    }
  }, i * HX.levelAllStaggerMs));
}

// "Equip Best" — every slot visibly swaps (staggered), then ONE power tween.
export function fxEquipBest(tileEl, slotEls, fromPow, toPow) {
  if (!tileEl) return;
  const powNode = tileEl.querySelector('.hs-pow b');
  if (powNode) powNode.textContent = fmt(fromPow);
  slotEls.forEach((s, i) => setTimeout(() => {
    s.animate([{ transform: 'scale(1)' }, { transform: 'scale(.68) rotate(-8deg)', offset: 0.3 }, { transform: 'scale(1.2) rotate(5deg)', offset: 0.72 }, { transform: 'scale(1)' }], { duration: HX.equipMs, easing: 'cubic-bezier(.2,1.25,.3,1)' });
    const flash = document.createElement('div'); flash.className = 'lvfx-flash'; fxHost(s).appendChild(flash);
    flash.animate([{ opacity: 0 }, { opacity: 0.95, offset: 0.45 }, { opacity: 0 }], { duration: HX.equipMs, easing: 'ease-out' }).onfinish = () => flash.remove();
  }, i * HX.equipStaggerMs));
  const after = Math.max(0, slotEls.length - 1) * HX.equipStaggerMs + HX.equipTailMs;
  setTimeout(() => { if (powNode) tween(powNode, fromPow, toPow, HX.equipPowMs, fmt); const c = centerOf(tileEl); particleBurst(c.x, c.y, false); }, after);
}

// Equip a specific item — the slot visibly swaps, THEN (after the swap) the stat change.
export function fxEquip(slotEl, tileEl, fromPow, toPow) {
  const dur = HX.equipMs;
  const powNode = tileEl && tileEl.querySelector('.hs-pow b');
  if (powNode) powNode.textContent = fmt(fromPow); // hold the old value during the swap
  if (slotEl) {
    slotEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(.68) rotate(-8deg)', offset: 0.3 }, { transform: 'scale(1.2) rotate(5deg)', offset: 0.72 }, { transform: 'scale(1)' }], { duration: dur, easing: 'cubic-bezier(.2,1.25,.3,1)' });
    const flash = document.createElement('div'); flash.className = 'lvfx-flash'; fxHost(slotEl).appendChild(flash);
    flash.animate([{ opacity: 0 }, { opacity: 0.95, offset: 0.45 }, { opacity: 0 }], { duration: dur, easing: 'ease-out' }).onfinish = () => flash.remove();
  }
  setTimeout(() => {
    if (powNode) tween(powNode, fromPow, toPow, HX.equipPowMs, fmt);
    if (slotEl) { const r = centerOf(slotEl); const delta = toPow - fromPow; floatText(r.x, r.y - 14, (delta >= 0 ? '+' : '') + delta + ' PWR', 'stat pwr', 0); }
  }, dur + 40);
}

// Hero FUSE (merge copies → +1 rarity) — the SAME choreography as gear fusing
// (GearScreen.onFuse): `count` fodder icons fly INTO the tile, then `onCommit`
// runs with the same fx-engine payoff (flash + shake + crit impact + big burst).
// The rarity-up reveal class is React-driven by the caller so it survives
// re-renders. Reuses the .fuse-fly clone class + the shared fx-engine primitives.
export function fxHeroFuse(tileEl, count, color, onCommit) {
  if (!tileEl) { onCommit(); return; }
  const artNode = tileEl.querySelector('.hs-art');
  const r = tileEl.getBoundingClientRect();
  const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
  const spots = count <= 1 ? [{ dx: 0, dy: 66 }] : [{ dx: -60, dy: 50 }, { dx: 60, dy: 50 }];
  spots.forEach((s, i) => {
    const clone = artNode ? artNode.cloneNode(true) : document.createElement('div');
    clone.classList.add('fuse-fly');
    clone.style.cssText = `position:fixed; left:${tx + s.dx}px; top:${ty + s.dy}px; width:${HX.fuseCloneSize}px; height:${HX.fuseCloneSize}px; object-fit:contain; display:grid; place-items:center; font-size:${HX.fuseCloneFont}px; z-index:9998; pointer-events:none; margin:0;`;
    document.body.appendChild(clone);
    clone.animate([
      { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${-s.dx}px), calc(-50% + ${-s.dy}px)) scale(0.3) rotate(230deg)`, opacity: 0.5 },
    ], { duration: HX.fuseFlyMs, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'forwards', delay: i * HX.fuseFlyStaggerMs });
    setTimeout(() => clone.remove(), HX.fuseReaperMs + i * HX.fuseFlyStaggerMs);
  });
  const landMs = HX.fuseFlyMs + (spots.length - 1) * HX.fuseFlyStaggerMs + HX.fuseLandTailMs;
  setTimeout(() => {
    onCommit();
    fx.flash(HX.fuseFlash.opacity, HX.fuseFlash.ms);
    fx.shake(HX.fuseShake);
    const c = fx.elCenter ? fx.elCenter(tileEl) : { x: tx, y: ty };
    if (c) fx.impact(c.x, c.y, { tier: 'crit', color, r: HX.fuseImpactR });
    particleBurst(tx, ty, true);
  }, landMs);
}
