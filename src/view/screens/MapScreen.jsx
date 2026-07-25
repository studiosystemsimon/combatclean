// ─────────────────────────────────────────────────────────────────────────────
// WORLD MAP — "Adventure Road" (view layer: RENDER + dispatch only)
// A Clash-Royale-style trophy road over the single battle ladder (state.battle.
// level). The journey climbs UPWARD: deepest zone on top, first zone at the bottom.
// Left rail = a LEVEL progress bar (filled up to the highest level reached, empty
// above, gold dot at that level) with a station badge per zone gate. Each arena is
// a full-bleed biome tile: the boss shows as a SILHOUETTE until that zone is beaten
// (cleared), then resolves to the real sticker. The right ~40% floats a Loot panel
// — the zone's 3 UNIQUE items + its ascension-crystal tier — each tappable for a
// context popup. (Random events are a later pass.) No combat panel on this screen
// (Game.jsx hides it). All facts come from data + pure map selectors; the view only
// dispatches actions.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../controller/GameContext';
import { ZONES } from '../../data/zones.js';
import { zoneStartLevel, zoneBossLevel, zoneIndexForLevel, afkRatesForLevel } from '../../model/map.js';
import { GEAR_PIECES, GEAR_RARITY } from '../../data/gear.js';
import { HERO_RARITIES } from '../../data/rarities.js';
import { resolve } from '../assets.js';
import Art from '../Art.jsx';
import { STRINGS } from '../../data/strings.js';
import { ANIM } from '../../data/config.js';
import { fmtK } from '../fmt.js';

const fmt = (n) => fmtK(Math.round(n));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const rarColor = (r) => (GEAR_RARITY[r] || GEAR_RARITY.common).color;
const crystalColor = (t) => (HERO_RARITIES[t] || HERO_RARITIES.common).color;
const zoneName = (zone) => STRINGS.zones[zone.nameKey];

// ── popup entry builders (name / type / colour / one-line explanation) ──────────
const itemEntry = (zone, pid) => {
  const p = GEAR_PIECES[pid];
  return {
    icon: resolve(p.asset), title: p.name, sub: `${cap(p.slot)} · ${cap(p.maxRarity)}`,
    subColor: rarColor(p.maxRarity), desc: `${p.power} — a rare drop from ${zoneName(zone)}.`,
  };
};
const crystalEntry = (zone) => {
  const t = zone.crystal;
  return {
    icon: resolve('ui.crystal'), title: `${cap(t)} Crystal`, sub: 'Ascension material',
    subColor: crystalColor(t), desc: `A necessary ingredient to ascend a ${cap(t)} hero. Farmed in ${zoneName(zone)}.`,
  };
};

function AfkPanel({ furthest, pending, onCollect }) {
  const r = afkRatesForLevel(furthest);
  const s = STRINGS.map;
  return (
    <div className="mp-afk">
      <div className="mp-afk-head">
        <span className="mp-afk-t">{s.afkTitle}{s.perHr}</span>
        <span className="mp-afk-rates">
          <span><Art a={resolve('ui.coin')} className="mp-ic" />{fmt(r.coinsPerHr)}</span>
          <span><Art a={resolve('ui.heroXp')} className="mp-ic" />{fmt(r.heroXpPerHr)}</span>
          <span><Art a={resolve('ui.gearXp')} className="mp-ic" />{fmt(r.gearXpPerHr)}</span>
        </span>
      </div>
      {pending && (
        <button type="button" className="mp-collect" onClick={onCollect}>
          <span className="mp-cw">{s.welcomeBack}</span>
          <span className="mp-camt">
            {pending.coins > 0 && <span><Art a={resolve('ui.coin')} className="mp-ic" />{fmt(pending.coins)}</span>}
            {pending.heroXp > 0 && <span><Art a={resolve('ui.heroXp')} className="mp-ic" />{fmt(pending.heroXp)}</span>}
            {pending.gearXp > 0 && <span><Art a={resolve('ui.gearXp')} className="mp-ic" />{fmt(pending.gearXp)}</span>}
          </span>
          <span className="mp-cbtn">{s.collect}</span>
        </button>
      )}
    </div>
  );
}

function ZoneRow({ zi, currentLevel, furthest, innerRef, onPop }) {
  const zone = ZONES[zi];
  const a = zoneStartLevel(zi);
  const b = zoneBossLevel(zi);
  const isLast = zi === ZONES.length - 1;
  const locked = a > furthest;
  const isCur = currentLevel >= a && (isLast || currentLevel <= b);
  const cleared = furthest > b && !isCur;
  const killed = cleared; // boss beaten once the zone is cleared → silhouette resolves

  // Left rail = a progress bar: fill up to the highest level reached; dot at that level.
  let fillStyle = null;
  let markerTop = null;
  if (furthest >= b) fillStyle = { top: '-13px', bottom: '-13px' };
  else if (furthest >= a) {
    const tp = (((b - furthest) / (b - a + 1)) * 100).toFixed(1) + '%';
    fillStyle = { top: tp, bottom: '-13px' };
    markerTop = tp;
  }

  const s = STRINGS.map;
  const stateChip = isCur
    ? <span className="mtile-state here">▶ {s.here}</span>
    : cleared ? <span className="mtile-state done">✓ {s.cleared}</span>
      : <span className="mtile-state locked">🔒</span>;

  return (
    <div className="arow" ref={innerRef}>
      <div className="mscale">
        {fillStyle && <span className="rfill" style={fillStyle} />}
        <span className="station">{b}{isLast ? '+' : ''}</span>
        {markerTop != null && <span className="marker" style={{ top: markerTop }} />}
      </div>
      <div className={`mtile ${locked ? 'locked' : ''} ${isCur ? 'cur' : ''}`}>
        <Art a={resolve(zone.keyArt)} className="mtile-bg" />
        <div className="mtile-scrim" />
        <div className="mtile-head">
          <div>
            <div className="mtile-name">{zoneName(zone)}</div>
            <div className="mtile-lv">Lv {a}–{b}{isLast ? '+' : ''}</div>
          </div>
          {stateChip}
        </div>
        <div className="mboss"><Art a={resolve(`enemy.${zone.bossId}`)} className={`mboss-img ${killed ? 'reveal' : 'silh'}`} /></div>
        {locked ? (
          <div className="mreq">🔒 Reach Lv {a}</div>
        ) : (
          <div className="msections">
            <div className="msect">
              <div className="msect-head">
                <span className="msect-t">{s.lootTitle}</span>
                <span
                  className="matchip"
                  style={{ '--rc': crystalColor(zone.crystal) }}
                  onClick={(e) => { e.stopPropagation(); onPop(crystalEntry(zone)); }}
                >
                  <Art a={resolve('ui.crystal')} className="matchip-img" />
                </span>
              </div>
              <div className="msrow">
                {(zone.items || []).map((pid) => (
                  <button
                    key={pid}
                    type="button"
                    className="mic"
                    style={{ '--rc': rarColor(GEAR_PIECES[pid].maxRarity) }}
                    onClick={() => onPop(itemEntry(zone, pid))}
                  >
                    <Art a={resolve(GEAR_PIECES[pid].asset)} className="mic-img" />
                    <span className="mic-rq" style={{ background: rarColor(GEAR_PIECES[pid].maxRarity) }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MapScreen() {
  const { state, actions } = useGame();
  const currentLevel = state.battle.level;
  const furthest = state.furthestLevel ?? currentLevel;
  const curZone = zoneIndexForLevel(currentLevel);
  const [pop, setPop] = useState(null);
  const hereRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => { hereRef.current?.scrollIntoView({ block: 'center' }); }, []);

  // Drag the map list up/down (mouse/pen; touch keeps native momentum scroll).
  // A drag past the threshold suppresses the trailing click so it never opens a
  // loot popup.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let down = false, moved = false, startY = 0, startTop = 0;
    const onDown = (e) => {
      if (e.pointerType === 'touch') return; // touch already pans natively
      down = true; moved = false; startY = e.clientY; startTop = el.scrollTop;
    };
    const onMove = (e) => {
      if (!down) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > ANIM.scrollDragThreshold) { moved = true; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch { /* noop */ } }
      if (moved) el.scrollTop = startTop - dy;
    };
    const onUp = (e) => { if (!down) return; down = false; el.classList.remove('dragging'); try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ } };
    const onClickCapture = (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  const order = ZONES.map((_, i) => i).reverse();
  return (
    <div className="map-screen">
      <AfkPanel furthest={furthest} pending={state.pendingAfk} onCollect={actions.collectAfk} />
      <div className="map-scroll" ref={scrollRef}>
        {order.map((zi) => (
          <ZoneRow key={ZONES[zi].id} zi={zi} currentLevel={currentLevel} furthest={furthest} innerRef={zi === curZone ? hereRef : null} onPop={setPop} />
        ))}
      </div>
      {pop && (
        <div className="mp-pop" onClick={() => setPop(null)}>
          <div className="mp-pop-card" onClick={(e) => e.stopPropagation()}>
            <div className="mp-pop-hd">
              <span className="mp-pop-ic"><Art a={pop.icon} className="mp-pop-img" /></span>
              <div>
                <div className="mp-pop-t">{pop.title}</div>
                <div className="mp-pop-s" style={{ color: pop.subColor }}>{pop.sub}</div>
              </div>
            </div>
            <div className="mp-pop-d">{pop.desc}</div>
            <button type="button" className="mp-pop-x" onClick={() => setPop(null)}>{STRINGS.map.gotIt}</button>
          </div>
        </div>
      )}
    </div>
  );
}
