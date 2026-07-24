// ─────────────────────────────────────────────────────────────────────────────
// GACHA PULL REVEAL (view VFX). Wraps the shared GachaRevealEngine (reveal-engine.js
// — the froggame-lineage 6-beat cinematic) and drives a HERO reveal that matches
// mockups/gacha.html EXACTLY: portrait pops in from white, a PEARLESCENT rarity +
// name plate scrolls, rarity pips stagger, epic+ can fake-out, mythic cracks reality
// and PRIMAL shatters it prismatically. Single pull = full cinematic + TAP-TO-CONTINUE;
// ×10 = sequential reveals (n/10 + SKIP) into a 5-column "YOU SUMMONED" summary grid.
//
// Reuses the engine's hooks (onFrogReveal / onNameBanner / onPip / onFakeUpgrade /
// setShake / setChroma / onAfterglowDone) — the ENGINE owns the canvas VFX + clock,
// this HOST owns the hero DOM. Inline styles only (no index.css edits); the shared
// `pearlScroll` / `bannerGlowSpin` / `bannerAuraPulse` keyframes already live in
// index.css and are reused, with the two reveal-local keyframes injected once here.
//
// Combat keeps running behind the reveal (it is NOT paused for gacha).
// One engine RAF + host timers; everything is cancelled + removed on dismiss.
// ─────────────────────────────────────────────────────────────────────────────

import { GachaRevealEngine, rarityMeta as fxRarityMeta } from './reveal-engine.js';
import { heroAsset } from '../assets.js';
import { HEROES } from '../../data/heroes.js';
import { HERO_RARITIES } from '../../data/rarities.js';
import { STRINGS } from '../../data/strings.js';

// per-tier dwell between ×10 reveals (indexed common→PRIMAL, 0-5) — ported from mockup.
const TEN_DWELL = [900, 1300, 2000, 2800, 3400, 4200];

const prefersReduced = () =>
  !!(typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Inject the two reveal-local keyframes ONCE (the others — pearlScroll / bannerGlowSpin
// / bannerAuraPulse — already exist in index.css and are referenced by name).
function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById('gr-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'gr-keyframes';
  s.textContent =
    '@keyframes gr-hintPulse{0%,100%{opacity:.45}50%{opacity:.95}}' +
    '@keyframes gr-bestPulse{0%,100%{box-shadow:0 0 12px 2px currentColor;transform:scale(1)}' +
    '50%{box-shadow:0 0 26px 7px currentColor;transform:scale(1.05)}}';
  document.head.appendChild(s);
}

const mk = (css) => { const d = document.createElement('div'); d.style.cssText = css; return d; };
const anim = (el, frames, opts) => {
  try { return el.animate(frames, opts); } catch { return null; }
};

// resolve a pull result → everything the reveal DOM needs.
function metaFor(res) {
  const hero = HEROES[res.id];
  const asset = hero ? heroAsset(res.id) : { emoji: '?', label: res.id, img: null }; // { emoji, label, img }
  const r = HERO_RARITIES[res.rarity] || HERO_RARITIES.common;
  const glowR = (fxRarityMeta(res.rarity) || {}).glowR || 0;
  const ms = (fxRarityMeta(res.rarity) || {}).ms || 900;
  return { id: res.id, rarity: res.rarity, name: (hero && hero.name) || asset.label || res.id, asset, r, glowR, ms };
}

function paintPortrait(el, m, emojiSize) {
  el.innerHTML = '';
  if (m.asset && m.asset.img) {
    const im = document.createElement('img');
    im.src = m.asset.img; im.draggable = false;
    im.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    el.appendChild(im);
  } else {
    el.textContent = (m.asset && m.asset.emoji) || '?';
    el.style.fontSize = emojiSize + 'px';
    el.style.lineHeight = '1';
  }
}

/**
 * Play the gacha pull reveal cinematic inside `containerEl` (the `.reveal-overlay`,
 * fixed inset:0 z1000). `results` = [{ id (heroId), rarity }] length 1 (single) or
 * 10 (×10). Calls `onDone()` once the player dismisses it, fully disposing the engine.
 *
 * @param {HTMLElement} containerEl  overlay mount (caller toggles its pointer-events)
 * @param {{results: Array<{id:string,rarity:string}>, bannerId?: string}} payload
 * @param {() => void} [onDone]
 * @returns {{ dispose: () => void } | null}
 */
export function playGachaReveal(containerEl, { results = [] } = {}, onDone) {
  if (!containerEl || !results.length) { onDone && onDone(); return null; }
  ensureKeyframes();
  const reduced = prefersReduced();
  const metas = results.map(metaFor);
  const isTen = metas.length > 1;

  // ---- state ----
  const timers = [];
  let disposed = false;
  let cur = metas[0];
  let pipEls = [];
  let awaitingTap = false;   // single: tap dismisses once the reveal settles
  let skipped = false;       // ×10: SKIP jumps to summary
  let summaryShown = false;

  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const clearTimers = () => { for (const id of timers) clearTimeout(id); timers.length = 0; };

  // ---- DOM scaffold (all inside the overlay; taps fall through to `root`) ----
  const root = mk('position:absolute;inset:0;overflow:hidden;');
  containerEl.appendChild(root);

  const veil = mk('position:absolute;inset:0;pointer-events:none;opacity:0;'
    + 'background:radial-gradient(120% 90% at 50% 42%, rgba(12,17,34,.55), rgba(5,7,15,.94));');
  root.appendChild(veil);

  // the engine mounts its canvases + tint/flash into engineWrap.
  const engineWrap = mk('position:absolute;inset:0;pointer-events:none;');
  root.appendChild(engineWrap);

  // hero wrap (centre-of-mass at the engine focal: 50% × 42%).
  // z-index:10 → ABOVE the engine's fx canvases (fxBack 2 / crack 6 / fxFront 9)
  // so the summoned hero reads clearly in FRONT of the VFX; only the brief screen
  // flash (11) washes over it.
  const heroWrap = mk('position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);z-index:10;'
    + 'display:flex;flex-direction:column;align-items:center;pointer-events:none;opacity:0;'
    + 'will-change:transform,filter,opacity;');
  const heroStage = mk('position:relative;width:230px;height:230px;display:flex;align-items:center;justify-content:center;');
  const aura = mk('position:absolute;inset:0;border-radius:50%;opacity:0;mix-blend-mode:screen;'
    + 'background:radial-gradient(circle, var(--gr-rc,#fff) 0%, transparent 62%);'
    + (reduced ? '' : 'animation:bannerAuraPulse 2.4s ease-in-out infinite;'));
  const ring = mk('position:absolute;inset:6px;border-radius:50%;opacity:0;filter:blur(2px);'
    + 'background:conic-gradient(from 0deg,transparent,var(--gr-rc,#fff),transparent 55%,var(--gr-rc,#fff),transparent);'
    + '-webkit-mask:radial-gradient(circle,transparent 60%,#000 62%,#000 76%,transparent 78%);'
    + 'mask:radial-gradient(circle,transparent 60%,#000 62%,#000 76%,transparent 78%);'
    + (reduced ? '' : 'animation:bannerGlowSpin 5s linear infinite;'));
  const face = mk('position:relative;z-index:2;width:190px;height:190px;display:flex;'
    + 'align-items:center;justify-content:center;opacity:0;');
  heroStage.append(aura, ring, face);

  const plate = mk('position:relative;margin-top:4px;text-align:center;opacity:0;will-change:transform,opacity;');
  const rarityLabel = mk("font-family:'Uniform Condensed Bold',system-ui,sans-serif;font-size:15px;"
    + 'font-weight:900;letter-spacing:5px;');
  const heroName = mk("font-family:'Uniform Bold',system-ui,sans-serif;font-size:34px;font-weight:900;"
    + 'letter-spacing:.5px;margin-top:2px;line-height:1.05;'
    + 'background:linear-gradient(100deg,hsl(0,70%,86%),hsl(60,70%,86%),hsl(120,70%,86%),hsl(180,70%,86%),'
    + 'hsl(240,70%,86%),hsl(300,70%,86%),hsl(360,70%,86%));background-size:200% auto;'
    + '-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;'
    // EXTERNAL-only outline: the fill is a TRANSPARENT gradient, so a centred
    // -webkit-text-stroke (even with paint-order:stroke fill) shows THROUGH the glyph
    // interior. An 8-way drop-shadow ring only ever renders OUTSIDE the letterform.
    + 'filter:drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000) drop-shadow(0 2px 0 #000) drop-shadow(0 -2px 0 #000) '
    + 'drop-shadow(1.5px 1.5px 0 #000) drop-shadow(-1.5px 1.5px 0 #000) drop-shadow(1.5px -1.5px 0 #000) drop-shadow(-1.5px -1.5px 0 #000);'
    + (reduced ? '' : 'animation:pearlScroll 5s linear infinite;'));
  const pipsEl = mk('display:flex;gap:7px;justify-content:center;margin-top:9px;height:28px;');
  plate.append(rarityLabel, heroName, pipsEl);
  heroWrap.append(heroStage, plate);
  root.appendChild(heroWrap);

  // single: tap-to-continue hint
  const hint = mk('position:absolute;left:0;right:0;bottom:46px;text-align:center;pointer-events:none;z-index:20;'
    + "opacity:0;color:#eef2ff;font-family:'Uniform Condensed Bold',system-ui,sans-serif;font-size:13px;"
    + 'font-weight:800;letter-spacing:1.5px;' + (reduced ? '' : 'animation:gr-hintPulse 1.4s ease-in-out infinite;'));
  hint.textContent = STRINGS.reveal.tapToContinue;
  root.appendChild(hint);

  // ×10 chrome
  const pullCount = mk('position:absolute;top:16px;left:16px;pointer-events:none;display:none;z-index:20;'
    + "color:#93a0c0;font-family:'Uniform Condensed Bold',system-ui,sans-serif;font-size:12px;font-weight:900;letter-spacing:1px;");
  const skipBtn = mk('position:absolute;top:14px;right:14px;display:none;cursor:pointer;pointer-events:auto;z-index:20;'
    + 'background:rgba(255,255,255,.06);border:1px solid rgba(150,175,255,.28);border-radius:999px;'
    + "padding:8px 15px;color:#eef2ff;font-family:'Uniform Condensed Bold',system-ui,sans-serif;font-size:12px;"
    + 'font-weight:900;letter-spacing:1px;');
  skipBtn.textContent = STRINGS.reveal.skip;
  skipBtn.setAttribute('data-gr-skip', '1');
  root.append(pullCount, skipBtn);

  // ---- rarity colour helpers ----
  const setRarityColor = (col) => { root.style.setProperty('--gr-rc', col); };

  // ---- engine hooks (host owns the hero DOM) ----
  const engine = new GachaRevealEngine(engineWrap, {
    reducedMotion: reduced,
    sound: () => {},
    onFrogReveal: (tier) => showHero(cur, tier),
    onNameBanner: (tier) => showPlate(cur, tier),
    onPip: (i) => showPip(i),
    onFakeUpgrade: () => setRarityColor(cur.r.color), // snap the theme to the REAL rarity
    setShake: (x, y, rot) => {
      heroWrap.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) rotate(${rot}deg)`;
    },
    setChroma: (px) => {
      heroWrap.style.filter = px > 0.1
        ? `drop-shadow(${px}px 0 0 rgba(255,0,60,.55)) drop-shadow(${-px}px 0 0 rgba(0,180,255,.55))`
        : 'none';
    },
    onAfterglowDone: () => { if (!isTen) onSingleSettled(); },
  });

  // pop the portrait in FROM WHITE + light the aura/ring.
  function showHero(m, tier) {
    setRarityColor(m.r.color);
    paintPortrait(face, m, 124);
    const glow = `drop-shadow(0 0 ${8 + m.glowR * 1.4}px ${m.r.color}) drop-shadow(0 8px 20px rgba(0,0,0,.55))`;
    face.style.filter = glow;
    heroWrap.style.opacity = '1';
    face.style.opacity = '1';
    const dur = reduced ? 160 : (tier >= 3 ? 620 : tier >= 1 ? 460 : 360);
    anim(face, [
      { opacity: 0, filter: `brightness(6) saturate(0) ${glow}` },
      { opacity: 1, filter: `brightness(2.2) saturate(.5) ${glow}`, offset: 0.55 },
      { opacity: 1, filter: `brightness(1) saturate(1) ${glow}` },
    ], { duration: dur, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    anim(heroStage, [
      { transform: 'scale(0.3)' },
      { transform: 'scale(1.12)', offset: 0.7 },
      { transform: 'scale(1)' },
    ], { duration: dur, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
    aura.style.opacity = String(tier >= 1 ? 0.9 : 0.6);
    anim(aura, [{ opacity: 0 }, { opacity: tier >= 1 ? 0.9 : 0.6 }], { duration: 420, easing: 'ease-out', fill: 'both' });
    if (tier >= 2 && !reduced) {
      ring.style.opacity = '0.85';
      anim(ring, [{ opacity: 0 }, { opacity: 0.85 }], { duration: 500, easing: 'ease-out', fill: 'both' });
    }
  }

  // reveal the PEARLESCENT rarity + name plate; pre-build the (hidden) pips.
  function showPlate(m, tier) {
    setRarityColor(m.r.color);
    rarityLabel.textContent = m.r.name;
    rarityLabel.style.color = m.r.color;
    rarityLabel.style.textShadow = `0 0 18px ${m.r.color}`;
    heroName.textContent = m.name;
    pipsEl.innerHTML = ''; pipEls = [];
    for (let i = 0; i < m.r.pips; i++) {
      const p = document.createElement('span');
      p.textContent = tier >= 3 ? '★' : '◆';
      p.style.cssText = `font-size:24px;line-height:1;color:${m.r.color};opacity:0;`
        + `transform:scale(0) rotate(-40deg);filter:drop-shadow(0 0 8px ${m.r.color});`;
      pipsEl.appendChild(p); pipEls.push(p);
    }
    plate.style.opacity = '1';
    anim(plate, [
      { transform: 'translateY(24px) scale(0.6)' },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: reduced ? 180 : (tier >= 2 ? 520 : 400), easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
  }

  function showPip(i) {
    const p = pipEls[i]; if (!p) return;
    p.style.opacity = '1'; p.style.transform = 'scale(1) rotate(0deg)';
    anim(p, [
      { opacity: 0, transform: 'scale(0) rotate(-40deg)' },
      { opacity: 1, transform: 'scale(1) rotate(0deg)' },
    ], { duration: reduced ? 160 : 360, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
  }

  function resetHeroDom() {
    heroWrap.style.opacity = '0';
    heroWrap.style.transform = 'translate(-50%,-50%)';
    heroWrap.style.filter = 'none';
    face.style.opacity = '0';
    aura.style.opacity = '0';
    ring.style.opacity = '0';
    plate.style.opacity = '0';
    pipsEl.innerHTML = ''; pipEls = [];
  }

  // ---- SINGLE flow ----
  function onSingleSettled() {
    if (disposed) return;
    awaitingTap = true;
    anim(hint, [{ opacity: 0 }, { opacity: 0.75 }], { duration: 300, easing: 'ease-out', fill: 'both' });
    hint.style.opacity = '0.75';
  }

  // ---- ×10 flow ----
  function runPull(idx) {
    if (disposed || skipped) return;
    if (idx >= metas.length) { toSummary(); return; }
    cur = metas[idx];
    pullCount.textContent = `PULL ${idx + 1} / ${metas.length}`;
    resetHeroDom();
    engine.play({ rarity: cur.rarity }, {});
    const dwell = TEN_DWELL[cur.r.tier] || 1500;
    later(() => runPull(idx + 1), cur.ms + dwell);
  }

  function toSummary() {
    if (disposed || summaryShown) return;
    clearTimers();
    try { engine.skip(); } catch { /* no-op */ }
    heroWrap.style.display = 'none';
    hint.style.display = 'none';
    skipBtn.style.display = 'none';
    pullCount.style.display = 'none';
    anim(engineWrap, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 120 : 260, easing: 'ease-out', fill: 'both' });
    buildSummary();
  }

  function buildSummary() {
    summaryShown = true;
    let bestIdx = 0;
    for (let i = 1; i < metas.length; i++) if (metas[i].r.tier > metas[bestIdx].r.tier) bestIdx = i;
    const bestTier = metas[bestIdx].r.tier;

    const panel = mk('position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;padding:22px;pointer-events:auto;'
      + 'background:radial-gradient(120% 90% at 50% 26%, rgba(14,20,40,.55), rgba(5,7,15,.94));');
    const h2 = mk("font-family:'Uniform Condensed Bold',system-ui,sans-serif;font-size:19px;font-weight:900;"
      + 'letter-spacing:3px;color:#ffd45e;text-shadow:0 0 16px rgba(255,212,94,.4);margin:0 0 14px;');
    h2.textContent = STRINGS.reveal.youSummoned;
    const grid = mk('display:grid;grid-template-columns:repeat(5,1fr);gap:8px;width:100%;max-width:430px;');
    panel.append(h2, grid);

    const seen = {};
    metas.forEach((m, i) => {
      const col = m.r.color;
      const dup = !!seen[m.id]; seen[m.id] = true;
      const tag = dup ? (m.r.tier >= 2 ? { t: 'ASCEND +1', c: '#78f0ff' } : { t: 'MERGE ▲', c: '#5ad17a' }) : null;
      const tile = mk('position:relative;aspect-ratio:.8;border-radius:12px;overflow:hidden;'
        + 'border:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;align-items:center;'
        + `justify-content:flex-end;background:#0c1122;color:${col};opacity:0;transform:scale(.5) translateY(14px);`);
      const taura = mk('position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,currentColor,transparent 62%);opacity:.22;');
      const tframe = mk('position:absolute;inset:0;border-radius:12px;pointer-events:none;box-shadow:0 0 0 1.5px currentColor inset;');
      const trar = mk('position:absolute;top:5px;left:5px;font-size:7.5px;font-weight:900;letter-spacing:.4px;'
        + `padding:2px 5px;border-radius:5px;background:rgba(0,0,0,.45);z-index:3;color:${col};`);
      trar.textContent = m.r.name;
      const tface = mk('position:absolute;top:12%;width:48px;height:48px;display:flex;align-items:center;'
        + 'justify-content:center;filter:drop-shadow(0 0 6px currentColor);z-index:2;');
      paintPortrait(tface, m, 30);
      const tn = mk('font-size:9px;font-weight:800;padding:4px 3px 3px;text-align:center;line-height:1.1;'
        + 'width:100%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.65));z-index:3;color:#fff;');
      tn.textContent = m.name;
      tile.append(taura, tframe, trar, tface, tn);
      if (tag) {
        const ttag = mk('position:absolute;bottom:24px;left:50%;transform:translateX(-50%);z-index:4;white-space:nowrap;'
          + `font-size:6.5px;font-weight:900;letter-spacing:.3px;color:#06121a;padding:2px 5px;border-radius:5px;background:${tag.c};`);
        ttag.textContent = tag.t;
        tile.appendChild(ttag);
      }
      if (i === bestIdx && bestTier >= 1 && !reduced) tile.style.animation = 'gr-bestPulse 1.3s ease-in-out infinite';
      grid.appendChild(tile);
      later(() => {
        tile.style.opacity = '1'; tile.style.transform = 'scale(1) translateY(0)';
        anim(tile, [
          { opacity: 0, transform: 'scale(.5) translateY(14px)' },
          { opacity: 1, transform: 'scale(1) translateY(0)' },
        ], { duration: reduced ? 160 : 420, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'both' });
      }, 150 + i * 90);
    });

    const cont = mk('margin-top:18px;width:min(90%,320px);cursor:pointer;pointer-events:auto;border:none;'
      + 'border-radius:14px;padding:13px 0;text-align:center;color:#fff;text-transform:uppercase;'
      + "font-family:'Uniform Condensed Bold',system-ui,sans-serif;font-weight:900;letter-spacing:.6px;font-size:14px;"
      + 'background:linear-gradient(135deg,#7a5cff,#2f8bff);box-shadow:0 8px 22px rgba(80,110,255,.4),0 0 0 1px rgba(255,255,255,.14) inset;');
    cont.textContent = STRINGS.reveal.continueBtn;
    cont.setAttribute('data-gr-continue', '1');
    cont.addEventListener('pointerdown', (e) => { e.stopPropagation(); dismiss(); });
    panel.appendChild(cont);
    root.appendChild(panel);
  }

  // ---- dismissal + cleanup ----
  function dismiss() {
    if (disposed) return;
    const a = anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 120 : 280, easing: 'ease-out', fill: 'both' });
    const done = () => { cleanup(); onDone && onDone(); };
    if (a && a.finished) a.finished.catch(() => {}).then(done); else done();
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    clearTimers();
    try { engine.dispose(); } catch { /* no-op */ }
    root.removeEventListener('pointerdown', onTap);
    if (root.parentNode) root.remove();
  }

  function onTap(e) {
    if (disposed) return;
    const t = e.target;
    if (t && t.closest && (t.closest('[data-gr-skip]') || t.closest('[data-gr-continue]'))) return;
    if (isTen) { if (summaryShown) dismiss(); }
    else if (awaitingTap) dismiss();
  }
  root.addEventListener('pointerdown', onTap);
  skipBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (skipped || summaryShown) return;
    skipped = true; toSummary();
  });

  // ---- GO ----
  anim(veil, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 120 : 300, easing: 'ease-out', fill: 'both' });
  veil.style.opacity = '1';
  if (isTen) {
    pullCount.style.display = 'block';
    skipBtn.style.display = 'block';
    runPull(0);
  } else {
    engine.play({ rarity: cur.rarity }, {});
  }

  return { dispose: () => { cleanup(); } };
}
