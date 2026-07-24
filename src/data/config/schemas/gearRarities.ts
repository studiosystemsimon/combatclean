// === gearRarities — KEY-kind logical config (the GEAR rarity ladder) ===
//
// Gear's OWN rarity ladder (common → uncommon → rare → epic → legendary), distinct from the hero
// `rarities` ladder — do not conflate. Fusing promotes a piece one tier along `order`. key-kind: a
// coded ladder. Presentation (name, colour) lives in UIConfig, keyed by the same key.
import { z } from 'zod';
import { zKeyConfig } from '@bishop/config-registry';

export const zGearRarityConfig = zKeyConfig
  .extend({
    order: z.number().int().describe('Ladder order low→high; fusion promotes one step along this.'),
    mul: z.number().describe('Power multiplier for gear of this rarity.'),
  })
  .strict();
