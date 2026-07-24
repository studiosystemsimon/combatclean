// === enemies — id-kind logical config ===
//
// An enemy/boss archetype. `displayName` is the slug (asset key stem `enemy.<slug>`). Combat HP/ATK
// are derived at runtime from these multipliers × the levelScaling singleton — the numeric id is the
// identity (never the slug). Presentation (name/flavour) + art live in UIConfig / assets, keyed by id.
import { z } from 'zod';
import { zConfig } from '@bishop/config-registry';

export const zEnemyConfig = zConfig
  .extend({
    hpMul: z.number().positive().describe('HP multiplier over the level-scaled base.'),
    atkMul: z.number().positive().describe('Attack multiplier over the level-scaled base.'),
    boss: z.boolean().optional().describe('True = a boss archetype (used at zone boss gates, amplified by levelScaling boss knobs).'),
  })
  .strict();
