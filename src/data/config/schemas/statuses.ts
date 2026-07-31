// === statuses — key-kind logical config (the combat status-effect vocabulary) ===
//
// A STATUS is a coded combat modifier the sim applies to a unit for a duration: an `op` the combat step
// switches on + its `magnitude` (data). Opposite pairs (ATK↑/↓, DEF↑/↓, SPD↑/↓) cancel newest-wins via
// `opposite`. key-kind because the op is a coded spine, not data-only content; presentation (name/colour/
// icon) lives in UIConfig keyed by this key, and the icon is an asset (`iconAssetId` → `status.<key>`).
import { z } from 'zod';
import { zKeyConfig, stringConfigRef } from '@bishop/config-registry';

export const zStatusConfig = zKeyConfig
  .extend({
    op: z.enum(['atkMul', 'dmgTakenMul', 'spdMul', 'regen', 'untargetable'])
      .describe('Coded op the combat step switches on: attack-output ×, incoming-damage ×, attack-cadence ×, HP regen/sec, or untargetable.'),
    magnitude: z.number().positive().optional()
      .describe('atkMul/dmgTakenMul/spdMul multiplier (>1 stronger/faster/tankier-inverse), or regen fraction of maxHP per second. Omit for untargetable.'),
    durationMs: z.number().int().positive().describe('Lifetime in ms once applied (refreshed on re-apply).'),
    kind: z.enum(['buff', 'debuff']).describe('Buff/debuff class (UI tint + design grouping).'),
    opposite: stringConfigRef('statuses', 'key').optional()
      .describe('The status this cancels on apply, newest-wins (→ statuses.key). Omit for none.'),
  })
  .strict()
  // The combat step MULTIPLIES and DIVIDES by magnitude (effAtk/dmgTakenMul/spdMul folds, focusDamage
  // pool accounting). A required, positive magnitude for those ops keeps bad data from feeding NaN /
  // division-by-zero into the sim; `untargetable` is a pure flag and must NOT carry a magnitude.
  .superRefine((s, ctx) => {
    const needsMag = s.op === 'atkMul' || s.op === 'dmgTakenMul' || s.op === 'spdMul' || s.op === 'regen';
    if (needsMag && s.magnitude == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['magnitude'], message: `op "${s.op}" requires a positive magnitude.` });
    if (s.op === 'untargetable' && s.magnitude != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['magnitude'], message: 'op "untargetable" must not have a magnitude.' });
  });
