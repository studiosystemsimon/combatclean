// === heroes — id-kind logical config (the playable roster) ===
//
// A HERO's LOGICAL data only: base stats + rarity/weapon-chain + ability blocks (charge/effect —
// NOT their display names). `displayName` is the slug (asset/editor label + the art key stem). All
// presentation (name, ability names, flavour) lives in UIConfig, keyed by the same id; art via assets.
// `baseHp` already includes the former global HP scale — there is NO runtime HP multiplier.
import { z } from 'zod';
import { zConfig, stringConfigRef } from '@bishop/config-registry';

// An ability effect: a coded primary `type` (burst/aoe/heal) + its magnitude, PLUS an optional status
// RIDER that applies alongside the primary. `mult` for burst/aoe, `frac` for heal. The rider is
// `statusKeys` applied to a `target` set — present on a burst/aoe/heal effect it fires IN ADDITION to
// the primary (e.g. a heal that also grants REGEN); type:'status' is a pure rider (no primary). Amounts:
// `statusMag` is a per-status-key magnitude OVERRIDE (exposed, else the status' own default), so the same
// status can be applied at different strengths by different heroes/rarities; `durationMs` overrides the
// applied statuses' default lifetime. Fields optional per the existing pattern (resolver-validated, no
// refine — keeps zEffect a plain object so nested statusKeys refs stay lintable).
const zEffect = z.object({
  type: z.enum(['burst', 'aoe', 'heal', 'status']).describe('Coded primary kind the combat step switches on (status = rider only).'),
  mult: z.number().optional().describe('Damage multiplier (burst/aoe).'),
  frac: z.number().optional().describe('Heal fraction of max HP (heal).'),
  statusKeys: z.array(stringConfigRef('statuses', 'key')).optional().describe('Status RIDER: statuses this effect applies (→ statuses.key), alongside any primary.'),
  target: z.enum(['self', 'allies', 'enemies', 'all']).optional().describe('Target set of the status rider.'),
  statusMag: z.record(z.string(), z.number().positive()).optional().describe('Per-status-key magnitude override for the rider ({ statusKey: amount }); omit a key to use its status default.'),
  durationMs: z.number().int().positive().optional().describe('Per-effect override of the applied statuses\' default duration (ms).'),
}).strict();

export const zHeroConfig = zConfig
  .extend({
    rarityKey: stringConfigRef('rarities', 'key').describe('Rarity tier (→ rarities.key).'),
    weaponChainKey: stringConfigRef('chains', 'key').describe('Weapon/merge chain this hero wields (→ chains.key); picks the trail colour.'),
    baseAtk: z.number().positive().describe('Base attack at level 1, rarity floor.'),
    baseHp: z.number().positive().describe('Base HP at level 1, rarity floor (includes the folded HP scale).'),
    baseDef: z.number().positive().describe('Base defense at level 1, rarity floor.'),
    normal: z.object({
      chargeMs: z.number().describe('Milliseconds of combat to auto-charge the normal ability.'),
      effect: zEffect,
    }).strict().describe('The auto-charging, auto-firing normal ability.'),
    limit: z.object({
      orders: z.number().int().describe('Completed orders required to charge the limit break.'),
      effect: zEffect,
    }).strict().describe('The limit break, charged by order fulfilment, fired on tap.'),
    classKey: stringConfigRef('heroClasses', 'key').describe("This hero-class's class (→ heroClasses.key); gates class-bound equip slots (the class accessory)."),
    flying: z.boolean().optional().describe('Flying class → hovering bob idle; grounded (default/absent) → a slight breathing idle instead. Provisional random assignment for now.'),
    slots: z.array(stringConfigRef('gearSlots', 'key')).optional().describe('The equip loadout THIS class has (→ gearSlots.key), ordered. Omit to inherit gearLoadout.defaultSlots.'),
  })
  .strict();
