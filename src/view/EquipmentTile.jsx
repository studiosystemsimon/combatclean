// Reusable equipment tiles, shared by the Gear grid and the Hero cards.
//   • SmallEquipmentTile  — a tiny slot with a rarity-coloured TOP LINE + the slot
//     icon (+ level). Used for a hero's 3 equipped slots (mockup gear-slot style).
//   • MediumEquipmentTile — the rarity-framed inventory tile with the full hero-tile
//     treatment: POWER pill (top-left), rarity PIPS (top-right), NAME (bottom-centre),
//     LEVEL (bottom-right), rarity wash + corner brackets + tier glow. Carries the
//     owner-hero avatar and a "ready to fuse" badge. Tap to open the action sheet.
import { HEROES } from '../data/heroes.js';
import { GEAR_SLOT_META, GEAR_RARITY, GEAR_RARITY_ORDER } from '../data/gear.js';
import { heroAsset, resolve } from './assets.js';
import Art from './Art.jsx';
import { gearPower } from '../model/gear.js';

export function SmallEquipmentTile({ g, slot }) {
  if (!g) {
    return (
      <div className={`small-eq empty r-empty`} title={`${GEAR_SLOT_META[slot].name} — empty`}>
        <span className="art-emoji small-eq-glyph" style={{ opacity: 0.4 }}>＋</span>
      </div>
    );
  }
  return (
    <div
      className={`small-eq r-${g.rarity}`}
      style={{ '--rar': GEAR_RARITY[g.rarity].color }}
      title={`${GEAR_RARITY[g.rarity].name} ${GEAR_SLOT_META[g.slot].name} · L${g.level}`}
    >
      <Art a={resolve(GEAR_SLOT_META[g.slot].asset)} className="small-eq-glyph" />
      <span className="small-eq-lv">{g.level}</span>
    </div>
  );
}

export function MediumEquipmentTile({ g, fuseReady, justFused, onOpen, roster }) {
  const rar = GEAR_RARITY[g.rarity];
  const tier = GEAR_RARITY_ORDER.indexOf(g.rarity); // 0 = common … 4 = legendary → pip count
  // g.equippedTo is a CID → resolve the Character, then its HERO archetype for name/art.
  const ownerChar = g.equippedTo ? roster?.[g.equippedTo] : null;
  const owner = ownerChar ? HEROES[ownerChar.hero] : null;
  return (
    <button
      type="button"
      data-gear={g.id}
      className={`gtile r-${g.rarity}${fuseReady ? ' fuse-ready' : ''}${justFused ? ' just-fused' : ''}`}
      style={{ '--rar': rar.color }}
      onClick={() => onOpen(g.id)}
    >
      <div className="gtile-sheen" />
      {/* item art, centred above the name bar (aspect-preserved) */}
      <Art a={resolve(GEAR_SLOT_META[g.slot].asset)} className="gt-glyph" />
      <span className="gt-pow"><span className="ic">💪</span><b>{gearPower(g)}</b></span>
      <span className="gt-pips">{Array.from({ length: tier + 1 }, (_, i) => <i key={i} />)}</span>
      {fuseReady ? <span className="gt-badge" title="Ready to fuse">▲</span> : null}
      <div className="gt-btm" />
      <span className="gt-name">{GEAR_SLOT_META[g.slot].name}</span>
      <span className="gt-lvl"><s>LV</s>{g.level}</span>
      {owner ? (
        <span className="gt-owner" title={`Equipped by ${owner.name}`}>
          <Art a={heroAsset(ownerChar.hero)} className="gt-owner-em" />
        </span>
      ) : null}
    </button>
  );
}
