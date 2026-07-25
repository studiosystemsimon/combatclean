// === generators — KEY-kind logical config ===
//
// A GENERATOR dispenses merge items, 1:1 with a chain (key == the chain it feeds). key-kind: a coded
// board actor. A generator is a LEVELLED board tile (awarded, then merged two-same → next level, the
// same way merge items merge). `dropsByLevel` holds one weighted tier-distribution PER generator level
// (index 0 = level 1); the array length IS the generator's max level. `weapon` names the VFX trail type.
// Asset (per level) + display name live in UIConfig / assets, keyed by this key.
import { z } from 'zod';
import { zKeyConfig, stringConfigRef } from '@bishop/config-registry';

const zDropTable = z
  .array(z.object({
    level: z.number().int().nonnegative().describe('Merge level dispensed (0-based).'),
    weight: z.number().positive().describe('Relative roll weight for this level.'),
  }).strict())
  .nonempty()
  .describe('Weighted table of which merge tier this generator level dispenses.');

export const zGeneratorConfig = zKeyConfig
  .extend({
    chainKey: stringConfigRef('chains', 'key').describe('The chain this generator dispenses (→ chains.key).'),
    weapon: stringConfigRef('chains', 'key').describe('VFX trail/weapon type when an order bashes apart (→ chains.key).'),
    energyCost: z.number().describe('Energy spent per tap to dispense one item.'),
    dropsByLevel: z
      .array(zDropTable)
      .nonempty()
      .describe('One weighted drop table PER generator level (index 0 = generator level 1). Array length = the generator max level; merging two same-level generators yields the next level, which dispenses from the next table.'),
  })
  .strict();
