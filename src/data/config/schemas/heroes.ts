// === heroes — id-kind logical config (the playable roster) ===
//
// A HERO's LOGICAL data only: base stats + rarity/weapon-chain + ability blocks (charge/effect —
// NOT their display names). `displayName` is the slug (asset/editor label + the art key stem). All
// presentation (name, ability names, flavour) lives in UIConfig, keyed by the same id; art via assets.
// `baseHp` already includes the former global HP scale — there is NO runtime HP multiplier.
import { z } from 'zod';
import { zConfig, stringConfigRef } from '@bishop/config-registry';

// An ability effect: a coded type + its magnitude. `mult` for burst/aoe, `frac` for heal.
const zEffect = z.object({
  type: z.enum(['burst', 'aoe', 'heal']).describe('Coded effect kind the combat step switches on.'),
  mult: z.number().optional().describe('Damage multiplier (burst/aoe).'),
  frac: z.number().optional().describe('Heal fraction of max HP (heal).'),
}).strict();

export const zHeroConfig = zConfig
  .extend({
    rarityKey: stringConfigRef('rarities', 'key').describe('Rarity tier (→ rarities.key).'),
    weaponChainKey: stringConfigRef('chains', 'key').describe('Weapon/merge chain this hero wields (→ chains.key); picks the trail colour.'),
    baseAtk: z.number().positive().describe('Base attack at level 1, rarity floor.'),
    baseHp: z.number().positive().describe('Base HP at level 1, rarity floor (includes the folded HP scale).'),
    normal: z.object({
      chargeMs: z.number().describe('Milliseconds of combat to auto-charge the normal ability.'),
      effect: zEffect,
    }).strict().describe('The auto-charging, auto-firing normal ability.'),
    limit: z.object({
      orders: z.number().int().describe('Completed orders required to charge the limit break.'),
      effect: zEffect,
    }).strict().describe('The limit break, charged by order fulfilment, fired on tap.'),
  })
  .strict();
