// === generators — KEY-kind logical config ===
//
// A GENERATOR dispenses merge items, 1:1 with a chain (key == the chain it feeds). key-kind: a coded
// board actor. `drops` is its weighted tier distribution. `weapon` names the VFX trail type. Asset +
// display name live in UIConfig / assets, keyed by this key.
import { z } from 'zod';
import { zKeyConfig, stringConfigRef } from '@bishop/config-registry';

export const zGeneratorConfig = zKeyConfig
  .extend({
    chainKey: stringConfigRef('chains', 'key').describe('The chain this generator dispenses (→ chains.key).'),
    weapon: stringConfigRef('chains', 'key').describe('VFX trail/weapon type when an order bashes apart (→ chains.key).'),
    energyCost: z.number().describe('Energy spent per tap to dispense one item.'),
    drops: z
      .array(z.object({
        level: z.number().int().nonnegative().describe('Merge level dispensed (0-based).'),
        weight: z.number().positive().describe('Relative roll weight for this level.'),
      }).strict())
      .describe('Weighted table of which tier this generator dispenses.'),
  })
  .strict();
