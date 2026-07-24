// === rarities — KEY-kind logical config (the HERO rarity ladder) ===
//
// The single canonical hero rarity ladder (common…primal), shared by gacha, collection, ascension,
// the reveal cinematic, and combat. key-kind: the reveal engine + tier comparisons switch on the key.
// Distinct from gearRarities (gear has its own ladder). Presentation (display name, colour) lives in
// UIConfig, keyed by the same key.
import { z } from 'zod';
import { zKeyConfig } from '@bishop/config-registry';

export const zRarityConfig = zKeyConfig
  .extend({
    order: z.number().int().describe('Rank order low→high (drives tier comparisons + array sort).'),
    tier: z.number().int().describe('0-based tier index the reveal cinematic escalates on.'),
    pips: z.number().int().describe('Pip count shown on cards.'),
    statMul: z.number().describe('Combat stat multiplier applied to a hero of this rarity.'),
    levelCap: z.number().int().describe('Max level a hero of this rarity can reach.'),
    prismatic: z.boolean().optional().describe('True = prismatic treatment (primal).'),
  })
  .strict();
