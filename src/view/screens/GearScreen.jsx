// Gear inventory — a 4-per-row GRID of rarity-framed equipment tiles
// (MediumEquipmentTile). Tap a tile → bottom sheet with LEVEL (spend 🔧) and FUSE
// (consume 2 same-slot+rarity items + a coin cost → promote a rarity tier). Fusing
// plays a timed sequence: the two fodder items fly INTO the target, which then
// bursts and morphs to its new rarity. Equipped items show the owner in the corner.
import { useState } from 'react';
import { useGame } from '../../controller/GameContext';
import { HEROES } from '../../data/heroes.js';
import { GEAR_SLOT_META, GEAR_RARITY, GEAR_FUSE, GEAR_RARITY_ORDER } from '../../data/gear.js';
import { STRINGS } from '../../data/strings.js';
import { resolve } from '../assets.js';
import Art from '../Art.jsx';
import PeekScroll from '../PeekScroll.jsx';
import { MediumEquipmentTile } from '../EquipmentTile.jsx';
import { fx } from '../fx/fx-engine.js';
import { ANIM, REVEAL, VFX_CONFIG } from '../../data/config.js';
import {
  gearPower,
  gearAtMax,
  gearLevelCost,
  canLevelGear,
  canFuse,
  canAffordFuse,
  fuseCost,
  fuseFodder,
  nextRarityFor,
  pieceName,
  pieceMaxRarity,
} from '../../model/gear.js';

// Fuse choreography reuses the shared hero-fx fuse primitives (single source — no parallel copy).
const HF = REVEAL.heroFx;

// Sort high→low rarity using the canonical ladder (no view-local rarity map).
const rankOf = (r) => GEAR_RARITY_ORDER.indexOf(r);
const sortGear = (list) => [...list].sort((a, b) => rankOf(b.rarity) - rankOf(a.rarity) || gearPower(b) - gearPower(a));

function GearSheet({ g, onClose, onLevel, onFuse }) {
  const { state } = useGame();
  const rar = GEAR_RARITY[g.rarity];
  const nr = nextRarityFor(g);
  const capRar = GEAR_RARITY[pieceMaxRarity(g)] || GEAR_RARITY.legendary;
  const ownerChar = g.equippedTo ? state.heroes[g.equippedTo] : null; // equippedTo is a cid
  const owner = ownerChar ? HEROES[ownerChar.hero] : null;
  const levelOk = canLevelGear(g, state.gearXp);
  const fuseOk = canAffordFuse(state.gear, g.id, state.coins);
  const fodder = fuseFodder(state.gear, g.id).length;
  const cost = fuseCost(g.rarity);
  return (
    <div className="gsheet open" role="dialog" aria-label="Gear actions">
      <div className="gsheet-grab" />
      <div className="gsheet-top" style={{ '--rar': rar.color }}>
        <div className={`gsheet-icon${g.rarity === 'legendary' ? ' leg' : ''}`}>
          <Art a={resolve(GEAR_SLOT_META[g.slot].asset)} className="gsheet-glyph" />
        </div>
        <div className="gsheet-info">
          <div className="gsheet-name">
            {rar.name} {pieceName(g) || GEAR_SLOT_META[g.slot].name}
          </div>
          <div className="gsheet-meta">{STRINGS.gear.level} {g.level} · Max <b style={{ color: capRar.color }}>{capRar.name}</b></div>
          <div className="gsheet-owner">{owner ? `${STRINGS.gear.equippedBy} ${owner.name}` : STRINGS.gear.unequipped}</div>
        </div>
        <div className="gsheet-pow">
          <div className="pv" key={g.level} style={{ animation: `powFlash ${ANIM.gear.powFlashMs}ms ease-out` }}>
            {gearPower(g)}
          </div>
          <div className="pl">{STRINGS.gear.power}</div>
        </div>
      </div>
      <div className="gsheet-actions">
        <button type="button" className="gsheet-btn level" disabled={!levelOk} onClick={() => onLevel(g.id)}>
          <span>{gearAtMax(g) ? STRINGS.gear.maxLevel : STRINGS.gear.levelUp}</span>
          {gearAtMax(g) ? null : <span className="cost">{resolve('ui.gearXp').emoji} {gearLevelCost(g.level)}</span>}
        </button>
        <button type="button" className="gsheet-btn fuse" disabled={!fuseOk} onClick={() => onFuse(g.id)}>
          <span>{nr ? `${STRINGS.gear.fusePrefix} ${GEAR_RARITY[nr].name}` : STRINGS.gear.maxRarity}</span>
          {nr ? <span className="cost">{resolve('ui.fuseFodder').emoji} {fodder}/{GEAR_FUSE.fodder} · {resolve('ui.coin').emoji} {cost}</span> : null}
        </button>
      </div>
    </div>
  );
}

export default function GearScreen() {
  const { state, actions } = useGame();
  const [selId, setSelId] = useState(null);
  const [justFused, setJustFused] = useState(null);
  const items = sortGear(Object.values(state.gear));
  const sel = selId != null ? state.gear[selId] : null;

  const onLevel = (id) => {
    const g = state.gear[id];
    if (!g || !canLevelGear(g, state.gearXp)) return;
    actions.levelGear(id); // sheet re-renders with new power (keyed power flash)
  };

  // Fuse choreography: the 2 weakest fodder items fly INTO the target tile, then
  // it bursts + morphs to its next rarity.
  const onFuse = (id) => {
    const g = state.gear[id];
    if (!g || !canAffordFuse(state.gear, id, state.coins)) return;
    const nr = nextRarityFor(g);
    const targetEl = document.querySelector(`[data-gear="${id}"]`);
    const tr = targetEl ? targetEl.getBoundingClientRect() : null;
    const fodder = fuseFodder(state.gear, id)
      .sort((a, b) => gearPower(a) - gearPower(b))
      .slice(0, GEAR_FUSE.fodder);
    setSelId(null); // close the sheet so the payoff is visible

    // fly each fodder item's icon into the target
    if (tr) {
      const tx = tr.left + tr.width / 2;
      const ty = tr.top + tr.height / 2;
      fodder.forEach((f, i) => {
        const fel = document.querySelector(`[data-gear="${f.id}"]`);
        if (!fel) return;
        fel.classList.add('consuming');
        const fr = fel.getBoundingClientRect();
        const cx = fr.left + fr.width / 2;
        const cy = fr.top + fr.height / 2;
        const clone = document.createElement('div');
        clone.className = 'fuse-fly';
        clone.textContent = resolve(GEAR_SLOT_META[f.slot].asset).emoji;
        clone.style.left = `${cx}px`;
        clone.style.top = `${cy}px`;
        document.body.appendChild(clone);
        clone.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
            { transform: `translate(calc(-50% + ${tx - cx}px), calc(-50% + ${ty - cy}px)) scale(0.32) rotate(230deg)`, opacity: 0.5 },
          ],
          { duration: HF.fuseFlyMs, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'forwards', delay: i * HF.fuseFlyStaggerMs },
        );
        setTimeout(() => clone.remove(), HF.fuseReaperMs + i * HF.fuseFlyStaggerMs);
      });
    }

    // after the fodder lands → commit the fuse + big rarity-up payoff
    const landMs = HF.fuseFlyMs + (fodder.length - 1) * HF.fuseFlyStaggerMs + HF.fuseLandTailMs;
    setTimeout(() => {
      actions.fuseGear(id);
      const tEl = document.querySelector(`[data-gear="${id}"]`);
      const fb = VFX_CONFIG.combat.fallbackCanvas;
      const c = tEl ? fx.elCenter(tEl) : { x: (fx.W || fb.w) / 2, y: (fx.H || fb.h) / 2 };
      fx.flash(HF.fuseFlash.opacity, HF.fuseFlash.ms);
      fx.shake(HF.fuseShake);
      fx.impact(c.x, c.y, { tier: 'crit', color: (nr && GEAR_RARITY[nr].color) || GEAR_RARITY[g.rarity].color, r: HF.fuseImpactR });
      setJustFused(id);
      setTimeout(() => {
        const el = document.querySelector(`[data-gear="${id}"]`);
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 20);
      setTimeout(() => setJustFused(null), ANIM.fuseRevealMs);
    }, landMs);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 12px 0' }}>
      <div className="rd-head">
        <h2>{resolve('ui.gearXp').emoji} {STRINGS.screens.gear}</h2>
        <span className="rd-pool">{resolve('ui.gearXp').emoji} {state.gearXp}</span>
      </div>
      {items.length === 0 ? (
        <div className="squad-note" style={{ flex: '0 0 auto' }}>
          {STRINGS.gear.empty}
        </div>
      ) : (
        <PeekScroll>
          <div className="gear-grid five">
            {items.map((g) => (
              <MediumEquipmentTile
                key={g.id}
                g={g}
                fuseReady={canAffordFuse(state.gear, g.id, state.coins)}
                justFused={justFused === g.id}
                onOpen={setSelId}
                roster={state.heroes}
              />
            ))}
          </div>
          <div className="gear-legend">{STRINGS.gear.legend}</div>
        </PeekScroll>
      )}

      {sel ? (
        <>
          <div className="gsheet-backdrop open" onClick={() => setSelId(null)} />
          <GearSheet g={sel} onClose={() => setSelId(null)} onLevel={onLevel} onFuse={onFuse} />
        </>
      ) : null}
    </div>
  );
}
