// ─────────────────────────────────────────────────────────────────────────────
// HEROES — condensed 5-wide roster + contextual action popup.
// Ported wholesale from docs/mockups/hero-tiles.html: tile = portrait · POWER
// top-left · LEVEL bottom-right · NAME centre-bottom · rarity = frame + pips · 3
// gear slots under (rarity = coloured TOP line only). Tap a hero → popup beside
// it (Level Up / Level Up Max / Equipment). Equipment → Reequip / Level All +1 /
// Level All Max. Reequip → pick a slot → choose a better item (with comparison).
// Squad = first SELECTED_SLOTS of state.order (highlighted band). All state goes
// through the reducer; all VFX through src/view/fx/hero-fx.js.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '../../controller/GameContext';
import { HEROES } from '../../data/heroes.js';
import { SELECTED_SLOTS, ANIM } from '../../data/config.js';
import { GEAR_SLOTS, GEAR_SLOT_META, GEAR_RARITY } from '../../data/gear.js';
import { HERO_RARITIES } from '../../data/rarities.js';
import { HERO_UPGRADE } from '../../data/progression.js';
import Art from '../Art.jsx';
import PeekScroll from '../PeekScroll.jsx';
import { heroAsset, resolve, portraitStyle } from '../assets.js';
import { heroPower, heroRarity, heroMaxLevel, canAscendChar, ascensionsDone, copiesOfHero, ownedHeroSet, ascendSelection } from '../../model/heroes.js';
import {
  heroGearPower, gearPower, equippedInSlot, slotCandidates, canEquipBetter, canUpgradeHeroGear,
} from '../../model/gear.js';
import { canLevelHero, heroLevelCost, heroAtMax, levelUpHeroMax } from '../../model/progression.js';
import { fxHeroLevelUp, fxMaxed, fxLevelAll, fxEquip, fxEquipBest, fxHeroFuse } from '../fx/hero-fx.js';
import { fmtK as fmt } from '../fmt.js';

// Touch gesture split: a quick drag SCROLLS the roster; a HELD drag (long-press) picks a hero up to
// drop into the squad. Mouse picks up on a small move (its wheel/scrollbar does the scrolling).
const HS = ANIM.heroes;
const HERO_DRAG_HOLD_MS = HS.dragHoldMs;    // touch: hold this long (without scrolling) to pick a hero up
const HERO_DRAG_SCROLL_TOL = HS.dragScrollTol;  // touch: moving this far before the hold fires = a scroll, not a pickup
const HERO_DRAG_MOVE_TOL = HS.dragMoveTol;     // mouse: move this far to actually start dragging

const gearIcon = (slot) => resolve(GEAR_SLOT_META[slot].asset).emoji;
const gearColor = (rarity) => (GEAR_RARITY[rarity] || GEAR_RARITY.common).color;
const slotEl = (id, slot) => document.querySelector(`.hs-gslot[data-hero-id="${id}"][data-slot="${slot}"]`);
const tileEl = (id) => document.querySelector(`.hs-tile[data-hero-id="${id}"]`);

export default function HeroesScreen() {
  const { state, actions } = useGame();
  const [popId, setPopId] = useState(null);
  const [popState, setPopState] = useState('hero'); // 'hero' | 'equip' | 'reequip'
  const [selSlot, setSelSlot] = useState(null);
  const [popPos, setPopPos] = useState({ x: -9999, y: -9999 });
  const popRef = useRef(null);
  const pending = useRef(null); // { id, kind, fromLv, fromPow, slot?, max? }
  const [sort, setSort] = useState('new'); // roster sort tile: 'new' (newest first) | 'rarity' | 'power'

  // Drag-swap: a body-level avatar follows the pointer (never clipped by the
  // scroll area); the hovered target displaces into the dragged hero's slot and
  // eases back if you move off. Drop commits via the existing swapHeroes action.
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [overTf, setOverTf] = useState('');
  const [justFused, setJustFused] = useState(null); // React-driven so the reveal survives re-renders
  const [confirmAsc, setConfirmAsc] = useState(null); // { keepCid, sacrificeCid } — pending ascend awaiting confirm
  const cellRefs = useRef({});
  const dragRef = useRef(null);
  const dragEnd = useRef(0); // performance.now() of the last drag end — suppresses the trailing click
  // Blocks the list from panning under the finger DURING an active touch drag. Added only while a drag
  // is live (see beginDrag), so ordinary scrolling keeps its passive fast-path (no jank).
  const blockScrollRef = useRef((e) => { const d = dragRef.current; if (d && d.started && d.touch) e.preventDefault(); });

  // `id` throughout this screen is a CID (a Character instance). heroPower/heroGearPower
  // take the archetype (char.hero) + the cid respectively.
  const gearPowOf = (cid) => heroGearPower(state.gear, cid);
  const powOf = (cid) => heroPower(state.heroes[cid].hero, state.heroes[cid], state.ordersCompleted, gearPowOf(cid));

  // ── VFX runs AFTER the reducer commits the new numbers, from before-values
  // captured at tap time (layout phase → the tween holds the old value with no
  // one-frame flash of the new one). A heroes/gear change with no pending request
  // is a no-op (e.g. a chest drop while this screen is mounted).
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const t = tileEl(p.id);
    const st = state.heroes[p.id];
    if (!st) return;
    const toPow = powOf(p.id);
    if (p.kind === 'lvup' || p.kind === 'lvmax') {
      fxHeroLevelUp(t, { fromLv: p.fromLv, toLv: st.level, fromPow: p.fromPow, toPow, cap: heroMaxLevel(st) });
    } else if (p.kind === 'equip') {
      fxEquip(slotEl(p.id, p.slot), t, p.fromPow, toPow);
    } else if (p.kind === 'levelall') {
      const entries = [];
      for (const slot of GEAR_SLOTS) {
        const b = p.before[slot];
        if (!b) continue;
        const g = state.gear[b.gid];
        if (!g) continue;
        const nowPow = gearPower(g);
        if (nowPow <= b.pow) continue; // this slot didn't gain a level
        entries.push({ slotEl: slotEl(p.id, slot), fromPow: b.pow, toPow: nowPow, fromLevel: b.level, toLevel: g.level, levels: g.level - b.level });
      }
      fxLevelAll(t, entries, p.fromPow, toPow);
    } else if (p.kind === 'equipbest') {
      const slots = [...document.querySelectorAll(`.hs-gslot[data-hero-id="${p.id}"]:not(.hs-empty)`)];
      fxEquipBest(t, slots, p.fromPow, toPow);
    }
  }, [state.heroes, state.gear]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Popup positioning (beside the active tile; flips to the left if it would
  // overflow the right edge; clamps to the viewport). Recomputed on state/size.
  useLayoutEffect(() => {
    if (!popId) return;
    const t = tileEl(popId);
    const el = popRef.current;
    if (!t || !el) return;
    const r = t.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let x = r.right + HS.popGap;
    if (x + pw > window.innerWidth - HS.popMargin) x = r.left - pw - HS.popGap;
    if (x < HS.popMargin) x = HS.popMargin;
    let y = r.top;
    if (y + ph > window.innerHeight - HS.popMargin) y = window.innerHeight - HS.popMargin - ph;
    if (y < HS.popMargin) y = HS.popMargin;
    setPopPos({ x, y });
  }, [popId, popState, selSlot, state.heroes, state.gear]);

  useEffect(() => {
    if (!popId) return undefined;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.hs-tile')) return; // tile taps switch heroes
      closePop();
    };
    const onResize = () => setPopPos((p) => ({ ...p })); // trigger the layout effect
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('pointerdown', onDown); window.removeEventListener('resize', onResize); };
  }, [popId]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPop = (id) => { setPopId(id); setPopState('hero'); setSelSlot(null); };
  const closePop = () => { setPopId(null); setPopState('hero'); setSelSlot(null); };

  // ── Actions (capture before-values, then dispatch; the effect drives the VFX) ──
  const doLevelUp = (id) => {
    const st = state.heroes[id];
    if (heroAtMax(st)) { fxMaxed(tileEl(id)); return; }
    if (!canLevelHero(st, state.heroXp)) return;
    pending.current = { id, kind: 'lvup', fromLv: st.level, fromPow: powOf(id) };
    actions.levelUpHero(id);
  };
  const doLevelUpMax = (id) => {
    const st = state.heroes[id];
    if (heroAtMax(st)) { fxMaxed(tileEl(id)); return; }
    if (levelUpHeroMax(st, state.heroXp).gained <= 0) return;
    pending.current = { id, kind: 'lvmax', fromLv: st.level, fromPow: powOf(id) };
    actions.levelUpHeroMax(id);
  };
  const doLevelAll = (id, max) => {
    if (!canUpgradeHeroGear(state.gear, id, state.gearXp)) return;
    const before = {}; // per-slot power + level, so the effect can show each gain
    GEAR_SLOTS.forEach((slot) => {
      const g = equippedInSlot(state.gear, id, slot);
      if (g) before[slot] = { gid: g.id, pow: gearPower(g), level: g.level };
    });
    pending.current = { id, kind: 'levelall', fromPow: powOf(id), before };
    if (max) actions.levelAllMax(id); else actions.levelAllOne(id);
  };
  const doEquipItem = (id, slot, gearId) => {
    pending.current = { id, kind: 'equip', slot, fromPow: powOf(id) };
    actions.equipItem(id, gearId);
  };
  const doEquipBest = (id) => {
    if (!canEquipBetter(state.gear, id)) return;
    pending.current = { id, kind: 'equipbest', fromPow: powOf(id) };
    actions.equipBest(id);
  };

  // ASCEND (the only hero-upgrade track): ALWAYS ascend the STRONGEST copy of a hero and
  // sacrifice the WEAKEST — the player never loses their main copy. Reuses the copies-fly-in
  // choreography (rarity fixed → payoff colour is the hero's own rarity). `ascendSelection`
  // is shared with the reducer so the confirm dialog names exactly the copy that dies.
  const upgradeColor = (cid) => (HERO_RARITIES[heroRarity(state.heroes[cid]) || 'common'] || HERO_RARITIES.common).color;
  const powerOfCid = (cid) => heroPower(state.heroes[cid].hero, state.heroes[cid], state.ordersCompleted, gearPowOf(cid));
  const ascendSelFor = (cid) => { const st = state.heroes[cid]; return st ? ascendSelection(state.heroes, st.hero, powerOfCid) : null; };
  // Gated on the STRONGEST copy (the one that gets ascended): needs only a duplicate to
  // sacrifice (ascendSelFor ≥ 2 copies) + not maxed. No crystals.
  const canAscendCid = (cid) => {
    const sel = ascendSelFor(cid);
    return !!sel && canAscendChar(state.heroes[sel.keepCid]);
  };
  const performAscend = (sel) => {
    const t = tileEl(sel.keepCid); // choreography plays on the SURVIVING (strongest) copy
    closePop();
    fxHeroFuse(t, 1, upgradeColor(sel.keepCid), () => {
      actions.ascendHero(sel.keepCid);
      setJustFused(sel.keepCid);
      setTimeout(() => setJustFused(null), ANIM.fuseRevealMs);
    });
  };
  const doAscend = (cid) => {
    const sel = ascendSelFor(cid);
    if (!sel || !canAscendCid(cid)) return;
    // Consuming a LEVELED copy (Lv > 1) is destructive → confirm first, naming that copy.
    // A fresh Lv1 copy is consumed with no prompt.
    if ((state.heroes[sel.sacrificeCid]?.level || 1) > 1) { closePop(); setConfirmAsc(sel); return; }
    performAscend(sel);
  };

  // ── Drag-swap (pointer). Touch: a quick drag SCROLLS the roster; a LONG-PRESS picks the hero up to
  // drop into the squad. Mouse: pick up on a small move (its wheel/scrollbar does the scrolling).
  // Avatar clone follows the finger; the hovered target displaces; drop commits swapHeroes (or eases home).
  const beginDrag = (d, clientX, clientY) => {
    const src = tileEl(d.id);
    if (!src) { clearTimeout(d.lp); if (dragRef.current === d) dragRef.current = null; return; }
    d.started = true;
    const r = src.getBoundingClientRect();
    d.originRect = r; d.grabDx = clientX - r.left; d.grabDy = clientY - r.top;
    d.lift = r.height * HS.dragLiftFrac; // raise the tile so it stays visible above the finger
    const rar = src.style.getPropertyValue('--rar');
    const av = src.cloneNode(true); // keeps the rarity class + cloned --rar (border / wash)
    av.classList.add('hs-drag-avatar');
    // Object.assign (NOT cssText) so the cloned --rar custom property survives.
    Object.assign(av.style, {
      position: 'fixed', left: `${clientX - d.grabDx}px`, top: `${clientY - d.grabDy}px`,
      width: `${r.width}px`, height: `${r.height}px`, margin: '0',
      zIndex: '1000', pointerEvents: 'none', transition: 'none',
      transform: `translateY(${-d.lift}px) scale(${HS.dragAvatarScale})`,
    });
    if (rar) av.style.setProperty('--rar', rar);
    document.body.appendChild(av);
    d.avatar = av;
    setDragId(d.id);
    setPopId(null); setPopState('hero'); setSelSlot(null); // a drag preempts the popup
    // Own the gesture for touch: stop the list panning under the finger for the rest of the drag.
    if (d.touch) document.addEventListener('touchmove', blockScrollRef.current, { passive: false });
  };
  const onTilePointerDown = (e, id) => {
    if (e.button != null && e.button !== 0) return;
    const touch = e.pointerType !== 'mouse';
    // armed = "hero pickup allowed". Mouse: armed now. Touch: only after the long-press timer fires —
    // until then a move is treated as a list scroll (see `move`). lp = the pending long-press timer.
    const d = { id, sx: e.clientX, sy: e.clientY, pid: e.pointerId, started: false, over: null, touch, armed: !touch, lp: null };
    dragRef.current = d;
    if (touch) d.lp = setTimeout(() => {
      if (dragRef.current === d && !d.started) beginDrag(d, d.sx, d.sy); // held still → pick up in place; moves position it
    }, HERO_DRAG_HOLD_MS);
  };
  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pid) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.started) {
        if (!d.armed) {
          // touch, before the long-press fires: a real move = the player is SCROLLING → drop the
          // pickup candidate and let the browser pan the list (touch-action: pan-y).
          if (Math.hypot(dx, dy) > HERO_DRAG_SCROLL_TOL) { clearTimeout(d.lp); dragRef.current = null; }
          return;
        }
        // mouse: pick the hero up once the pointer moves past the start threshold.
        if (Math.hypot(dx, dy) < HERO_DRAG_MOVE_TOL) return;
        beginDrag(d, e.clientX, e.clientY);
        if (!d.started) return;
      }
      if (d.avatar) { d.avatar.style.left = `${e.clientX - d.grabDx}px`; d.avatar.style.top = `${e.clientY - d.grabDy}px`; }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el && el.closest && el.closest('[data-hid]');
      const tid = cell && cell.getAttribute('data-hid');
      const over = tid && tid !== d.id ? tid : null;
      if (over !== d.over) {
        d.over = over;
        if (over) {
          // The CELL is never transformed (only the inner tile), so its rect is the
          // target's NATURAL slot — the displacement + landing both key off this.
          const oc = cellRefs.current[over];
          const ot = oc ? oc.getBoundingClientRect() : tileEl(over).getBoundingClientRect();
          d.overRect = ot;
          setOverTf(`translate(${d.originRect.left - ot.left}px, ${d.originRect.top - ot.top}px)`);
          setOverId(over);
        } else { d.overRect = null; setOverId(null); setOverTf(''); }
      }
    };
    const finish = (e) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pid) return;
      clearTimeout(d.lp); // cancel a pending long-press (a tap or scroll that never became a drag)
      dragRef.current = null;
      if (!d.started) return;
      dragEnd.current = performance.now(); // swallow the click that trails this pointerup
      const { avatar: av, over } = d;
      const done = () => { if (av) av.remove(); setDragId(null); setOverId(null); setOverTf(''); document.removeEventListener('touchmove', blockScrollRef.current); };
      const glide = (left, top, then) => {
        if (!av) { then(); return; }
        void av.offsetWidth; // commit the current position so the transition eases FROM here
        const gl = `${HS.dragGlideMs}ms ${ANIM.curves.easeOut}`;
        av.style.transition = `left ${gl}, top ${gl}, transform ${gl}`;
        av.style.transform = 'scale(1)'; // drop the upward lift so it settles flush on the slot
        av.style.left = `${left}px`; av.style.top = `${top}px`;
        setTimeout(then, HS.dragGlideMs + 5);
      };
      if (over) {
        // Land on the target's NATURAL slot (cell rect), not tileEl(over) — that
        // still carries the displacement transform and would send it back to origin.
        const oc = cellRefs.current[over];
        const nr = d.overRect || (oc && oc.getBoundingClientRect()) || d.originRect;
        glide(nr.left, nr.top, () => { actions.swapHeroes(d.id, over); done(); });
      } else {
        glide(d.originRect.left, d.originRect.top, done);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.removeEventListener('touchmove', blockScrollRef.current); // safety if unmounted mid-drag
    };
  }, [actions]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = Object.keys(HEROES).length;
  const ownedCount = ownedHeroSet(state.heroes).size; // distinct HEROES owned (collection metric)

  const renderCell = (id) => {
    const st = state.heroes[id]; // id is a cid → this Character
    const def = HEROES[st.hero]; // the HERO archetype
    const rar = heroRarity(st) || 'common';
    const meta = HERO_RARITIES[rar] || HERO_RARITIES.common;
    const power = powOf(id);
    const atMax = heroAtMax(st);
    const active = popId === id;
    // The tile's ▲ upgrade badge tracks REAL availability so it never advertises an
    // action the popup then hides (ascend needs a duplicate Character + crystals).
    const canUpgrade = canAscendCid(id);

    const tileStyle = { '--rar': meta.color };
    let extra = '';
    if (dragId === id) extra += ' hs-dragsrc'; // hollow "hole" — the avatar follows the pointer
    else if (overId === id) { tileStyle.transform = overTf; tileStyle.transition = `transform ${HS.dragSwapMs}ms ${ANIM.curves.easeOut}`; tileStyle.zIndex = 6; }
    else if (dragId) tileStyle.transition = `transform ${HS.dragSwapMs}ms ${ANIM.curves.easeOut}`; // ease home when no longer hovered
    if (canUpgrade) extra += ' fuse-ready';
    if (justFused === id) extra += ' just-fused';

    return (
      <div className={`hs-cell ${active ? 'hs-active' : ''}`} key={id} data-hid={id} ref={(el) => { cellRefs.current[id] = el; }}>
        <button
          type="button"
          className={`hs-tile r-${rar}${extra}`}
          data-hero-id={id}
          style={tileStyle}
          title={def.name}
          onPointerDown={(e) => onTilePointerDown(e, id)}
          onClick={() => {
            if (performance.now() - dragEnd.current < HS.dragClickSuppressMs) return; // this click trailed a drag
            actions.setHeroMenu(id); // open the full-screen hero menu (replaces the old side popup)
          }}
        >
          <span className="hs-prism" />
          <div className="fxwrap" />
          <Art a={heroAsset(st.hero)} className="hs-art" style={portraitStyle(def.portrait)} />
          <span className="hs-pow"><span className="hs-ic">⚔</span><b>{fmt(power)}</b></span>
          {/* Dots = ASCENSION level: one per possible tier (maxAscensions), filled up to
              ascensionsDone, empty for the rest. Rarity is shown by the tile frame colour. */}
          <span className="hs-pips">{Array.from({ length: HERO_UPGRADE.maxAscensions }, (_, k) => <i key={k} className={k < ascensionsDone(st) ? 'on' : ''} />)}</span>
          {canUpgrade ? <span className="gt-badge" title="Upgrades available">▲</span> : null}
          <div className="hs-btm" />
          <span className="hs-name">{def.name}</span>
          <span className={`hs-lvl ${atMax ? 'max' : ''}`}><s>LV</s>{st.level}</span>
        </button>
        <div className="hs-gearrow">
          {GEAR_SLOTS.map((slot) => {
            const g = equippedInSlot(state.gear, id, slot);
            return g ? (
              <div key={slot} className="hs-gslot" data-hero-id={id} data-slot={slot} style={{ '--gr': gearColor(g.rarity) }}>
                <span className="hs-gi">{gearIcon(slot)}</span>
                <b className="hs-glv">{g.level}</b>
              </div>
            ) : (
              <div key={slot} className="hs-gslot hs-empty" data-hero-id={id} data-slot={slot}><span className="hs-gi">+</span></div>
            );
          })}
        </div>
      </div>
    );
  };

  const squad = state.order.slice(0, SELECTED_SLOTS);
  const squadPower = squad.reduce((sum, cid) => sum + powOf(cid), 0); // combined power of the active squad
  // Roster sort (the filter tile). Squad is left in its manual order; only the roster reorders.
  // Drag-swap is cid-identity based (SWAP_HEROES), so sorting the DISPLAY never mis-swaps.
  // cid number rises with acquisition → newest = highest cid → 'new' surfaces fresh pulls at the top.
  const cidNum = (c) => Number(String(c).slice(1)) || 0;
  const rarityTier = (c) => ((HERO_RARITIES[heroRarity(state.heroes[c]) || 'common'] || HERO_RARITIES.common).tier ?? 0);
  const roster = useMemo(() => {
    const arr = state.order.slice(SELECTED_SLOTS);
    if (sort === 'rarity') return [...arr].sort((a, b) => rarityTier(b) - rarityTier(a) || cidNum(b) - cidNum(a));
    if (sort === 'power') { const p = new Map(arr.map((c) => [c, powOf(c)])); return [...arr].sort((a, b) => p.get(b) - p.get(a) || cidNum(b) - cidNum(a)); }
    return [...arr].sort((a, b) => cidNum(b) - cidNum(a)); // 'new' — newest first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.order, state.heroes, state.gear, state.ordersCompleted, sort]);

  return (
    <div className={`hs-roster ${popId ? 'hs-ctx' : ''}`}>
      <div className="hs-head">
        <div className="hs-ttl">HEROES</div>
        <div className="hs-pools">
          <span className="hs-pool book">📘 {fmt(state.heroXp)}</span>
          <span className="hs-pool wrench">🔧 {fmt(state.gearXp)}</span>
          <span className="hs-cnt">{ownedCount} / {total}</span>
        </div>
      </div>
      <PeekScroll>
        <div className="hs-sqhdr">
          <span className="hs-seclabel sq">★ Current Squad</span>
          <span className="hs-sqpow"><span className="hs-sqpow-ic">⚔</span>{fmt(squadPower)}</span>
        </div>
        <div className="hs-squad-band"><div className="hs-grid">{squad.map(renderCell)}</div></div>
        {roster.length ? <>
          <div className="hs-rlabel">
            <span className="hs-seclabel">Roster</span>
            <div className="hs-sort" role="group" aria-label="Sort roster">
              {[['new', 'New'], ['rarity', 'Rarity'], ['power', 'Power']].map(([k, label]) => (
                <button key={k} type="button" className={`hs-sort-btn ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="hs-grid">{roster.map(renderCell)}</div>
        </> : null}
      </PeekScroll>

      {popId ? createPortal(
        <Popup
          id={popId}
          state={state}
          popState={popState}
          selSlot={selSlot}
          pos={popPos}
          popRef={popRef}
          setPopState={setPopState}
          setSelSlot={setSelSlot}
          powOf={powOf}
          onLevelUp={doLevelUp}
          onLevelUpMax={doLevelUpMax}
          onLevelAll={doLevelAll}
          onEquipItem={doEquipItem}
          onEquipBest={doEquipBest}
          onAscend={doAscend}
          canAscend={canAscendCid(popId)}
        />, document.body) : null}

      {/* Ascend consumes a LEVELED copy → confirm, naming the exact Character that dies
          (the weakest copy; the strongest is the one that gets ascended). */}
      {confirmAsc ? createPortal((() => {
        const sac = state.heroes[confirmAsc.sacrificeCid];
        const keep = state.heroes[confirmAsc.keepCid];
        if (!sac || !keep) return null;
        const sacMeta = HERO_RARITIES[heroRarity(sac) || 'common'] || HERO_RARITIES.common;
        return (
          <>
            <div className="ability-backdrop" onClick={() => setConfirmAsc(null)} />
            <div className="ability-pop" role="dialog" aria-label="Confirm ascension">
              <div className="hs-pop-head">
                <div className="hs-ph-ic" style={{ '--rar': sacMeta.color }}><Art a={heroAsset(sac.hero)} className="hs-ph-art" style={portraitStyle(HEROES[sac.hero].portrait)} /></div>
                <div>
                  <div className="hs-ph-nm">Consume this copy?</div>
                  <div className="hs-ph-sub">{HEROES[sac.hero].name} · Lv {sac.level} will be destroyed to ascend your {HEROES[keep.hero].name}.</div>
                </div>
              </div>
              <div className="hs-pop-btns">
                <button type="button" className="hs-pop-btn green" onClick={() => { const s = confirmAsc; setConfirmAsc(null); performAscend(s); }}>✦ Ascend</button>
                <button type="button" className="hs-pop-btn ghost" onClick={() => setConfirmAsc(null)}>Cancel</button>
              </div>
            </div>
          </>
        );
      })(), document.body) : null}
    </div>
  );
}

function Popup({ id, state, popState, selSlot, pos, popRef, setPopState, setSelSlot, powOf, onLevelUp, onLevelUpMax, onLevelAll, onEquipItem, onEquipBest, onAscend, canAscend }) {
  const st = state.heroes[id]; // id is a cid → this Character
  const def = HEROES[st.hero]; // the HERO archetype
  const rar = heroRarity(st) || 'common';
  const meta = HERO_RARITIES[rar] || HERO_RARITIES.common;
  const cap = heroMaxLevel(st);
  const atMax = heroAtMax(st);
  const canLvl = canLevelHero(st, state.heroXp);
  const canLvlMax = !atMax && levelUpHeroMax(st, state.heroXp).gained > 0;
  const canUpg = canUpgradeHeroGear(state.gear, id, state.gearXp);
  const canBetter = canEquipBetter(state.gear, id);
  const copies = copiesOfHero(state.heroes, st.hero); // total Characters of this hero (incl. this one)
  const asc = ascensionsDone(st);
  // Ascension just needs a DUPLICATE Character to sacrifice (copies ≥ 2) + not maxed.
  // The `canAscend` gate is computed by the parent (canAscendCid).

  return (
    <div ref={popRef} className="hs-pop" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
      <div className="hs-pop-head">
        <div className="hs-ph-ic" style={{ '--rar': meta.color }}><Art a={heroAsset(st.hero)} className="hs-ph-art" style={portraitStyle(def.portrait)} /></div>
        <div>
          <div className="hs-ph-nm">{def.name} <span style={{ color: meta.color, fontWeight: 800 }}>{meta.name}</span></div>
          <div className="hs-ph-sub">Lv {st.level}/{cap} · <b>⚔ {fmt(powOf(id))}</b></div>
          <div className="hs-ph-sub">Copies {copies} · Ascend {asc}/{HERO_UPGRADE.maxAscensions}</div>
        </div>
      </div>

      {popState === 'hero' ? (
        <div className="hs-pop-btns">
          <button type="button" className="hs-pop-btn gold" disabled={!canLvl && !atMax} onClick={() => onLevelUp(id)}>
            {atMax ? '★ Max Level' : '⬆ Level Up'}
          </button>
          <button type="button" className="hs-pop-btn gold" disabled={!canLvlMax} onClick={() => onLevelUpMax(id)}>⏫ Level Up Max</button>
          {/* ASCEND only appears when actually possible: a DUPLICATE Character of this
              hero to sacrifice (copies ≥ 2) + not maxed + crystals of the hero's rarity.
              +1 ability level AND +level cap. Otherwise hidden, not shown greyed. */}
          {canAscend && (
            <button type="button" className="hs-pop-btn green" onClick={() => onAscend(id)}>
              ✦ Ascend {asc}/{HERO_UPGRADE.maxAscensions}
              <span className="hs-asc-req"> 🔁 sacrifices 1 copy</span>
            </button>
          )}
          <button type="button" className="hs-pop-btn blue" onClick={() => setPopState('equip')}>🛡 Equipment</button>
        </div>
      ) : popState === 'equip' ? (
        <div className="hs-pop-btns">
          <button type="button" className="hs-pop-btn blue" onClick={() => { setPopState('reequip'); setSelSlot(null); }}>♻ Reequip</button>
          <button type="button" className="hs-pop-btn green" disabled={!canUpg} onClick={() => onLevelAll(id, false)}>＋ Level All +1</button>
          <button type="button" className="hs-pop-btn green" disabled={!canUpg} onClick={() => onLevelAll(id, true)}>⏫ Level All Max</button>
          <button type="button" className="hs-pop-btn ghost" onClick={() => setPopState('hero')}>◀ Back</button>
        </div>
      ) : (
        <ReequipBody
          id={id} state={state} selSlot={selSlot} setSelSlot={setSelSlot}
          onEquipItem={onEquipItem} onEquipBest={onEquipBest} canBetter={canBetter}
          onBack={() => setPopState('equip')}
        />
      )}
    </div>
  );
}

function ReequipBody({ id, state, selSlot, setSelSlot, onEquipItem, onEquipBest, canBetter, onBack }) {
  const cur = selSlot ? equippedInSlot(state.gear, id, selSlot) : null;
  const cands = selSlot ? slotCandidates(state.gear, id, selSlot) : [];
  return (
    <>
      <div className="hs-reeq-lbl">Tap a slot to swap</div>
      <div className="hs-reeq-slots">
        {GEAR_SLOTS.map((slot) => {
          const g = equippedInSlot(state.gear, id, slot);
          return (
            <button
              key={slot}
              type="button"
              className={`hs-reeq-slot ${g ? '' : 'hs-empty'} ${selSlot === slot ? 'sel' : ''}`}
              style={{ '--gr': g ? gearColor(g.rarity) : 'rgba(255,255,255,.15)' }}
              onClick={() => setSelSlot(slot)}
            >
              {g ? gearIcon(slot) : '+'}
            </button>
          );
        })}
      </div>

      {selSlot ? <>
        <div className="hs-cmp-cur">
          {cur
            ? <>Equipped: <b style={{ color: gearColor(cur.rarity) }}>{GEAR_RARITY[cur.rarity].name}</b> · ⚔ {gearPower(cur)}</>
            : <>Slot empty — pick an item below</>}
        </div>
        <div className="hs-cmp-list">
          {cands.length ? cands.map((g) => {
            const d = gearPower(g) - (cur ? gearPower(cur) : 0);
            return (
              <button key={g.id} type="button" className="hs-cmp-item" style={{ '--gr': gearColor(g.rarity) }} onClick={() => onEquipItem(id, selSlot, g.id)}>
                <span className="hs-ci-ic">{gearIcon(selSlot)}</span>
                <span className="hs-ci-nm" style={{ color: gearColor(g.rarity) }}>{GEAR_RARITY[g.rarity].name}</span>
                <span className="hs-ci-pw">⚔ {gearPower(g)}</span>
                <span className={`hs-ci-d ${d >= 0 ? 'up' : 'dn'}`}>{d >= 0 ? '▲ +' : '▼ '}{Math.abs(d)}</span>
              </button>
            );
          }) : <div className="hs-cmp-none">No other items for this slot</div>}
        </div>
      </> : null}

      <div className="hs-pop-btnrow">
        <button type="button" className="hs-pop-btn ghost" onClick={onBack}>◀</button>
        <button type="button" className="hs-pop-btn blue" disabled={!canBetter} onClick={() => onEquipBest(id)}>✨ Equip Best</button>
      </div>
    </>
  );
}
