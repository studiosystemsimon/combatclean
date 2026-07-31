// ─────────────────────────────────────────────────────────────────────────────
// HERO MENU — full-screen isolated hero detail (AFK-Arena style), ported from
// docs/mockups/hero-menu-mockup.html. Opened by tapping a hero in HeroesScreen
// (actions.setHeroMenu(cid)); rendered by Game.jsx as a top overlay. While it is
// open, Game.jsx unmounts the combat panel + FxLayer and GameContext pauses the
// ticks — nothing renders/grinds underneath.
//
// Read-only over model selectors; every mutation goes through the controller
// actions. Level-up / gear VFX reuse the shared hero-fx primitives (fxMenu*),
// fired AFTER the reducer commits via a pending-ref + useLayoutEffect (same
// pattern as HeroesScreen), so the value nodes count up old→new.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGame } from '../../controller/GameContext';
import { HEROES } from '../../data/heroes.js';
import { uiHero } from '../../data/_ui.js';
import { HERO_RARITIES } from '../../data/rarities.js';
import { HERO_UPGRADE } from '../../data/progression.js';
import { GEAR_SLOT_META, GEAR_RARITY } from '../../data/gear.js';
import {
  heroStats, heroPower, heroMaxLevel, heroRarity, ascensionsDone, ascendSelection, canAscendChar,
} from '../../model/heroes.js';
import { canLevelHero, heroLevelCost, levelUpHeroMax, heroAtMax } from '../../model/progression.js';
import {
  heroGearPower, equippedInSlot, slotCandidates, otherHeroSlotItems, gearPower, heroClassOf,
  gearLevelCost, canLevelGear, canEquipBetter, canUpgradeHeroGear,
} from '../../model/gear.js';
import { resolve, heroAsset } from '../assets.js';
import { fmtK as fmt } from '../fmt.js';
import { fxMenuHeroLevelUp, fxMenuGearBurst, fxMenuPow, fxMenuEquip, fxMenuEquipSlot, fxMaxed } from '../fx/hero-fx.js';

const HERO_BG = resolve('ui.hero-bg').img;
const gearIcon = (slot) => resolve(GEAR_SLOT_META[slot].asset).emoji || GEAR_SLOT_META[slot].emoji;
const gColor = (r) => (GEAR_RARITY[r] || GEAR_RARITY.common).color;
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const abilDesc = (a) => (!a ? '' : a.type === 'heal'
  ? `Heals the party for ${Math.round((a.frac || 0) * 100)}% of max HP.`
  : a.type === 'aoe' ? `Deals ${a.mult}× ATK to all enemies.` : `Deals ${a.mult}× ATK to the focus target.`);

export default function HeroMenu() {
  const { state, actions } = useGame();
  const cid = state.menuHeroId;

  const heroImgRef = useRef(null);
  const powRef = useRef(null), hpRef = useRef(null), atkRef = useRef(null), defRef = useRef(null), lvRef = useRef(null);
  const gearSlotRefs = useRef({});   // side equipment tiles, per slot
  const eqCurRef = useRef(null);     // equip dialog's current-item icon
  const pending = useRef(null);
  const eqGridRef = useRef(null);

  const [equipSlot, setEquipSlot] = useState(null);   // open equip dialog for this slot
  const [confirmEq, setConfirmEq] = useState(null);   // { slot, item } awaiting confirm
  const [confirmAsc, setConfirmAsc] = useState(null); // { keepCid, sacrificeCid } awaiting ascend confirm
  const [skillIdx, setSkillIdx] = useState(null);     // open ability detail

  const char = cid ? state.heroes[cid] : null;

  // stat snapshot for the fx (computed at call time = before; in the effect = after)
  const snap = () => {
    const gp = heroGearPower(state.gear, cid);
    const s = heroStats(char.hero, char, state.ordersCompleted, gp);
    return { lv: char.level, pow: heroPower(char.hero, char, state.ordersCompleted, gp), hp: s.maxHp, atk: s.atk, def: s.def };
  };

  // Fire the queued VFX AFTER the reducer commits (the value nodes already show the new numbers;
  // the tweens count them up from the captured "before").
  useLayoutEffect(() => {
    const p = pending.current; if (!p || !char) return; pending.current = null;
    const after = snap();
    const nodes = { hero: heroImgRef.current, lv: lvRef.current, pow: powRef.current, hp: hpRef.current, atk: atkRef.current, def: defRef.current };
    if (p.kind === 'hero') fxMenuHeroLevelUp(nodes, p.before, after, heroMaxLevel(char));
    else if (p.kind === 'equip') fxMenuEquip(eqCurRef.current, powRef.current, p.before.pow, after.pow);
    else if (p.kind === 'gearone') { fxMenuGearBurst(eqCurRef.current); fxMenuPow(powRef.current, p.before.pow, after.pow); }
    else if (p.kind === 'equipbest') { // EQUIP (not level): flash each CHANGED slot + its power delta vs what was there before. No "LEVEL UP".
      (p.slots || []).forEach((slot) => {
        const g = equippedInSlot(state.gear, cid, slot);
        const afterId = g ? g.id : null, afterPow = g ? gearPower(g) : 0;
        const b = p.beforeSlots ? p.beforeSlots[slot] : null;
        if (afterId !== (b ? b.id : null)) fxMenuEquipSlot(gearSlotRefs.current[slot], afterPow - (b ? b.pow : 0));
      });
      fxMenuPow(powRef.current, p.before.pow, after.pow);
    }
    else { // gearall (Level All) — LEVEL UP burst per levelled slot + one power count-up
      (p.slots || []).forEach((slot) => fxMenuGearBurst(gearSlotRefs.current[slot]));
      fxMenuPow(powRef.current, p.before.pow, after.pow);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [state.heroes, state.gear]);

  // Drag-to-scroll the equip grid (scrollbars hidden; peek + fade mask signal overflow). Mouse only —
  // touch keeps native momentum. A move past threshold suppresses the trailing click (no accidental equip).
  useEffect(() => {
    const el = eqGridRef.current; if (!el) return undefined;
    let down = false, sy = 0, st = 0, moved = false;
    const dn = (e) => { if (e.pointerType !== 'mouse') return; down = true; moved = false; sy = e.clientY; st = el.scrollTop; };
    const mv = (e) => { if (!down) return; const dy = e.clientY - sy; if (Math.abs(dy) > 4) moved = true; el.scrollTop = st - dy; };
    const up = () => { down = false; };
    const clk = (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    el.addEventListener('pointerdown', dn); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); el.addEventListener('click', clk, true);
    return () => { el.removeEventListener('pointerdown', dn); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); el.removeEventListener('click', clk, true); };
  }, [equipSlot]);

  if (!char) return null; // menu flagged open but the hero is gone → render nothing (Game unmounts on close)

  const def = HEROES[char.hero];
  const ui = uiHero(char.hero) || {};
  const rar = heroRarity(char) || def.rarity || 'common';
  const meta = HERO_RARITIES[rar] || HERO_RARITIES.common;
  const gp = heroGearPower(state.gear, cid);
  const stats = heroStats(char.hero, char, state.ordersCompleted, gp);
  const power = heroPower(char.hero, char, state.ordersCompleted, gp);
  const cap = heroMaxLevel(char);
  const atMax = heroAtMax(char);
  const abilLv = (char.abilityLevel || 1);
  const ascDone = ascensionsDone(char);
  const art = heroAsset(char.hero);
  const cls = heroClassOf(char.hero); const slots = cls.slots; // this class's equip loadout (+ classKey for class-bound slots)
  const equippedSlots = slots.filter((s) => equippedInSlot(state.gear, cid, s));
  // Ascend (merge a duplicate copy → +1 rank). Reuses the reducer-shared selection so the confirm names
  // the exact copy consumed; ALWAYS keeps the strongest copy and sacrifices the weakest.
  const ascSel = ascendSelection(state.heroes, char.hero, (c) => heroPower(state.heroes[c].hero, state.heroes[c], state.ordersCompleted, heroGearPower(state.gear, c)));
  const canAscend = !!ascSel && canAscendChar(state.heroes[ascSel.keepCid]);

  // ── actions (capture before → dispatch → effect fires the fx) ──
  const doLevelUp = () => { if (atMax) { fxMaxed(heroImgRef.current); return; } if (!canLevelHero(char, state.heroXp)) return; pending.current = { kind: 'hero', before: snap() }; actions.levelUpHero(cid); };
  const doLevelUpMax = () => { if (atMax) { fxMaxed(heroImgRef.current); return; } if (levelUpHeroMax(char, state.heroXp).gained <= 0) return; pending.current = { kind: 'hero', before: snap() }; actions.levelUpHeroMax(cid); };
  const doLevelGear = (max) => { if (!canUpgradeHeroGear(state.gear, cid, state.gearXp)) return; pending.current = { kind: 'gearall', before: snap(), slots: equippedSlots }; if (max) actions.levelAllMax(cid); else actions.levelAllOne(cid); };
  const doEquipBest = () => {
    if (!canEquipBetter(state.gear, cid, cls)) return;
    const beforeSlots = {}; // per-slot equipped piece BEFORE → power delta after equip-best (0 if the slot was empty)
    slots.forEach((s) => { const g = equippedInSlot(state.gear, cid, s); beforeSlots[s] = g ? { id: g.id, pow: gearPower(g) } : null; });
    pending.current = { kind: 'equipbest', before: snap(), slots, beforeSlots };
    actions.equipBest(cid);
  };
  const doLevelGearOne = () => { const g = equippedInSlot(state.gear, cid, equipSlot); if (!g || !canLevelGear(g, state.gearXp)) return; pending.current = { kind: 'gearone', before: snap(), slot: equipSlot }; actions.levelGear(g.id); };
  const doEquip = (slot, item) => { pending.current = { kind: 'equip', before: snap(), slot }; actions.equipItem(cid, item.id); setConfirmEq(null); };
  // Ascend: count up the SURVIVING (kept) copy's stats old→new; if the menu was open on the sacrificed
  // copy, follow the survivor so the menu doesn't vanish. Destroying a leveled copy asks to confirm first.
  const snapOf = (c) => { const h = state.heroes[c]; const gp = heroGearPower(state.gear, c); const s = heroStats(h.hero, h, state.ordersCompleted, gp); return { lv: h.level, pow: heroPower(h.hero, h, state.ordersCompleted, gp), hp: s.maxHp, atk: s.atk, def: s.def }; };
  const runAscend = (sel) => { pending.current = { kind: 'hero', before: snapOf(sel.keepCid) }; actions.ascendHero(sel.keepCid); if (cid !== sel.keepCid) actions.setHeroMenu(sel.keepCid); };
  const doAscend = () => { if (!canAscend || !ascSel) return; const sac = state.heroes[ascSel.sacrificeCid]; if ((sac?.level || 1) > 1) { setConfirmAsc(ascSel); return; } runAscend(ascSel); };

  const cycle = (dir) => { const order = state.order; const i = order.indexOf(cid); if (i < 0) return; actions.setHeroMenu(order[(i + dir + order.length) % order.length]); };

  // ── equip dialog data ──
  const cur = equipSlot ? equippedInSlot(state.gear, cid, equipSlot) : null;
  const items = equipSlot ? [...slotCandidates(state.gear, cid, equipSlot, cls), ...otherHeroSlotItems(state.gear, cid, equipSlot, cls)] : [];

  const rootStyle = { '--rar': meta.color };
  const tier = (meta.name || rar).toUpperCase();

  return (
    <div className="hero-menu" style={rootStyle}>
      <div className="hm-bg" style={{ backgroundImage: HERO_BG ? `url(${HERO_BG})` : 'none' }} />
      <div className="hm-tint" /><div className="hm-scrim" />

      <button className="hm-back" onClick={() => actions.setHeroMenu(null)}>‹</button>

      <div className="hm-header">
        <div className="hm-emblems">
          <div className="emb"><span>✨</span></div><div className="emb-line" />
          {canAscend ? (
            <button type="button" className="emb diamond asc-ready" onClick={doAscend} aria-label="Ascend hero" title={`Ascend ${ascDone}/${HERO_UPGRADE.maxAscensions}`}><span className="g">◆</span></button>
          ) : (
            <div className="emb diamond"><span className="g">◆</span></div>
          )}
          <div className="emb-line" />
          <div className="emb"><span>✊</span></div>
        </div>
        <div className="hm-titles">
          <div className="t-tier hm-ol">{tier}</div>
          <div className="t-class hm-ol">{def.weapon ? cap1(def.weapon) : ''} {def.name}</div>
          <div className="t-name hm-ol">{def.name}</div>
        </div>
      </div>

      <div className="hm-body">
        <div className="side-col left">
          {slots.map((slot) => {
            const g = equippedInSlot(state.gear, cid, slot);
            return (
              <div key={slot} ref={(el) => { gearSlotRefs.current[slot] = el; }}
                   className={`gslot${g ? '' : ' empty'}`} style={g ? { '--gr': gColor(g.rarity) } : undefined}
                   onClick={() => { setEquipSlot(slot); setConfirmEq(null); }}>
                <span className="gi">{gearIcon(slot)}</span>
                {g && <span className="glvl hm-ol">{g.level}</span>}
              </div>
            );
          })}
        </div>
        <div className="side-col right">
          {[['👊', 'basic'], ['✨', 'normal'], ['💥', 'limit']].map(([ic, k], i) => (
            <button key={k} className="abil" onClick={() => setSkillIdx(i)}>
              <span className="ai">{ic}</span><span className="alv">{abilLv}</span>
            </button>
          ))}
        </div>
        <div className="hm-stage">
          <div className="hm-dais" />
          {art.img
            ? <img ref={heroImgRef} className="hm-img" src={art.img} alt={def.name} />
            : <div ref={heroImgRef} className="hm-img hm-emoji">{art.emoji}</div>}
        </div>
        <button className="nav l" onClick={() => cycle(-1)}>‹</button>
        <button className="nav r" onClick={() => cycle(1)}>›</button>
      </div>

      <div className="hm-foot">
        <div className="hm-stats">
          <div className="power-line"><span className="pw-ic">✊</span><span className="pw-val hm-ol" ref={powRef}>{fmt(power)}</span></div>
          <div className="stat-row">
            <div className="stat"><span className="lvbadge hm-ol">LV</span><div className="sv"><b className="hm-ol" ref={lvRef}>{char.level}</b><small>Level</small></div></div>
            <div className="stat"><span className="ico">❤️</span><div className="sv"><b className="hm-ol" ref={hpRef}>{fmt(stats.maxHp)}</b><small>Health</small></div></div>
            <div className="stat"><span className="ico">🗡️</span><div className="sv"><b className="hm-ol" ref={atkRef}>{fmt(stats.atk)}</b><small>Attack</small></div></div>
            <div className="stat"><span className="ico">🛡️</span><div className="sv"><b className="hm-ol" ref={defRef}>{fmt(stats.def)}</b><small>Defense</small></div></div>
          </div>
        </div>
        <div className="hm-actions">
          <div className="lvl-stacks">
            <div className="lvl-stack">
              <button className="btn primary" disabled={atMax && !canLevelHero(char, state.heroXp)} onClick={doLevelUp}>
                {atMax ? '★ MAX LEVEL' : <>LEVEL UP<small>📘 {fmt(heroLevelCost(char.level))}</small></>}
              </button>
              <button className="btn side" disabled={atMax || levelUpHeroMax(char, state.heroXp).gained <= 0} onClick={doLevelUpMax}>LEVEL UP MAX</button>
            </div>
            <div className="lvl-stack">
              <button className="btn b" disabled={!canUpgradeHeroGear(state.gear, cid, state.gearXp)} onClick={() => doLevelGear(false)}>LEVEL GEAR</button>
              <button className="btn b" disabled={!canUpgradeHeroGear(state.gear, cid, state.gearXp)} onClick={() => doLevelGear(true)}>LEVEL GEAR MAX</button>
              <button className="btn side" disabled={!canEquipBetter(state.gear, cid, cls)} onClick={doEquipBest}>⚡ EQUIP BEST</button>
            </div>
          </div>
        </div>
      </div>

      {/* ascend confirm — destroying a leveled copy names the exact Character consumed */}
      {confirmAsc && (() => {
        const keep = state.heroes[confirmAsc.keepCid]; const sac = state.heroes[confirmAsc.sacrificeCid];
        if (!keep || !sac) return null;
        return (
          <div className="hm-sheet open">
            <div className="hm-sheet-bd" onClick={() => setConfirmAsc(null)} />
            <div className="hm-card">
              <h4>Ascend {HEROES[keep.hero].name}</h4>
              <div className="skdesc">{HEROES[sac.hero].name} · Lv {sac.level} will be destroyed to ascend your {HEROES[keep.hero].name}.</div>
              <div className="eq-btns">
                <button className="hm-close" style={{ flex: 1, marginTop: 0 }} onClick={() => setConfirmAsc(null)}>Cancel</button>
                <button className="btn primary" style={{ flex: 1 }} onClick={() => { const s = confirmAsc; setConfirmAsc(null); runAscend(s); }}>✦ Ascend</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ability detail */}
      {skillIdx != null && (() => {
        const A = [['👊', 'Basic', ui.abilityNames?.basic || 'Attack', 'Standard attack on the focus target.'],
          ['✨', 'Skill', ui.abilityNames?.normal || 'Skill', `${abilDesc(def.normal?.effect)} Charges every ${((def.normal?.chargeMs || 0) / 1000).toFixed(1)}s.`],
          ['💥', 'Ultimate', ui.abilityNames?.limit || 'Ultimate', `${abilDesc(def.limit?.effect)} Fires after ${def.limit?.orders} orders.`]][skillIdx];
        return (
          <div className="hm-sheet open" onClick={() => setSkillIdx(null)}>
            <div className="hm-sheet-bd" />
            <div className="hm-card" onClick={(e) => e.stopPropagation()}>
              <div className="skhead"><div className="sc">{A[0]}</div><div><div className="styp">{A[1]} · Lv {abilLv}</div><div className="snm">{A[2]}</div></div></div>
              <div className="skdesc">{A[3]}</div>
              <button className="hm-close" onClick={() => setSkillIdx(null)}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* equip dialog */}
      {equipSlot && (
        <div className="hm-sheet open">
          <div className="hm-sheet-bd" onClick={() => setEquipSlot(null)} />
          <div className="hm-card eq-card">
            <button className="hm-x" onClick={() => setEquipSlot(null)}>✕</button>
            <h4>Equip · {cap1(equipSlot)}</h4>
            <div className="eq-cur">
              {cur ? <>
                <div className="ic" ref={eqCurRef} style={{ '--gr': gColor(cur.rarity) }}><span>{gearIcon(equipSlot)}</span><span className="glvl hm-ol">{cur.level}</span></div>
                <div><div className="nm">{cap1(cur.rarity)} {cap1(equipSlot)}</div><div className="rr" style={{ color: gColor(cur.rarity) }}>Lv {cur.level}</div></div>
                <div className="pw">⚔ {fmt(gearPower(cur))}</div>
              </> : <>
                <div className="ic" ref={eqCurRef}><span>{gearIcon(equipSlot)}</span></div>
                <div><div className="nm">Empty slot</div><div className="rr" style={{ color: 'var(--dim)' }}>pick an item below</div></div>
              </>}
            </div>
            <div className="eq-grid" ref={eqGridRef}>
              {items.length ? items.map((g) => {
                const d = gearPower(g) - (cur ? gearPower(cur) : 0);
                const on = cur && cur.id === g.id;
                const owner = g.equippedTo && g.equippedTo !== cid ? state.heroes[g.equippedTo] : null;
                return (
                  <div key={g.id} className={`eq-item${on ? ' on' : ''}`} style={{ '--gr': gColor(g.rarity) }}
                       onClick={() => { if (on) return; setConfirmEq({ slot: equipSlot, item: g }); }}>
                    {on && <span className="eqbadge">✓</span>}
                    <span className="gi">{gearIcon(equipSlot)}</span>
                    <span className="pw">⚔ {fmt(gearPower(g))}</span>
                    <span className={`d ${d >= 0 ? 'up' : 'dn'}`}>{on ? 'equipped' : (d >= 0 ? `▲ +${fmt(d)}` : `▼ ${fmt(Math.abs(d))}`)}</span>
                    {owner && <span className="owner">👤{HEROES[owner.hero].name[0]}</span>}
                    <span className="glvl hm-ol">{g.level}</span>
                  </div>
                );
              }) : <div className="eq-none">No items for this slot.</div>}
            </div>
            <div className="eq-btns">
              <button className="btn primary" disabled={!cur || !canLevelGear(cur, state.gearXp)} onClick={doLevelGearOne}>
                {cur ? <>LEVEL UP<small>🔧 {fmt(gearLevelCost(cur.level))}</small></> : 'LEVEL UP'}
              </button>
              <button className="btn b" disabled={!canEquipBetter(state.gear, cid, cls)} onClick={doEquipBest}>⚡ EQUIP BEST</button>
            </div>
          </div>
        </div>
      )}

      {/* comparison + move confirm */}
      {confirmEq && (() => {
        const it = confirmEq.item, slot = confirmEq.slot;
        const c0 = equippedInSlot(state.gear, cid, slot);
        const owner = it.equippedTo && it.equippedTo !== cid ? state.heroes[it.equippedTo] : null;
        const col = (item, label) => item
          ? <div className="ci" style={{ '--gr': gColor(item.rarity) }}><div className="cl">{label}</div><div className="cx">{gearIcon(slot)}<span className="clv">Lv{item.level}</span></div><div className="cn" style={{ color: gColor(item.rarity) }}>{item.rarity.toUpperCase()}</div><div className="cst">⚔ {fmt(gearPower(item))}</div></div>
          : <div className="ci"><div className="cl">{label}</div><div className="cx">➖</div><div className="cn" style={{ color: 'var(--dim)' }}>Empty</div><div className="cst" style={{ color: 'var(--dim)' }}>⚔ 0</div></div>;
        const d = gearPower(it) - (c0 ? gearPower(c0) : 0);
        return (
          <div className="hm-sheet open">
            <div className="hm-sheet-bd" onClick={() => setConfirmEq(null)} />
            <div className="hm-card">
              <h4>Change {cap1(slot)}</h4>
              <div className="cmp-cols">{col(c0, 'Equipped')}<div className="cmp-arrow">→</div>{col(it, 'New')}</div>
              <div className="cmp-deltas"><div className="dl"><span>POW</span><b className={d >= 0 ? 'up' : 'dn'}>{d >= 0 ? `▲ +${fmt(d)}` : `▼ ${fmt(Math.abs(d))}`}</b></div></div>
              {owner && <div className="cmp-warn show">⚠ Currently equipped by <b>{HEROES[owner.hero].name}</b>. Equipping will remove it from them.</div>}
              <div className="eq-btns">
                <button className="hm-close" style={{ flex: 1, marginTop: 0 }} onClick={() => setConfirmEq(null)}>Cancel</button>
                <button className="btn primary" style={{ flex: 1 }} onClick={() => doEquip(slot, it)}>EQUIP</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
