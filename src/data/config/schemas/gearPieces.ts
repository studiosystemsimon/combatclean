// === gearPieces — id-kind logical config ===
//
// A gear PIECE definition (the template a rolled instance is minted from). `displayName` is the slug.
// Equip constraint via `slot` (→ gearSlots), rarity ceiling via `maxRarityKey` (→ gearRarities).
// Uniques (`unique:true`) drop only from their zone. The unique's power EFFECT is display text (a
// later combat system) → it lives in UIConfig (`power`), not here. Presentation (name/power text) +
// art live in UIConfig / assets, keyed by id.
import { z } from 'zod';
import { zConfig, stringConfigRef } from '@bishop/config-registry';

export const zGearPieceConfig = zConfig
  .extend({
    slot: stringConfigRef('gearSlots', 'key').describe('Equip slot family (→ gearSlots.key).'),
    maxRarityKey: stringConfigRef('gearRarities', 'key').describe('Highest rarity this piece can roll/fuse to (→ gearRarities.key).'),
    classKey: stringConfigRef('heroClasses', 'key').optional().describe('Set for a class-bound piece (a classAccessory) — it only fits a hero-class whose classKey matches (→ heroClasses.key).'),
    unique: z.boolean().optional().describe('True = a unique piece that drops only from its zone chests (excluded from normal rolls).'),
  })
  .strict();
