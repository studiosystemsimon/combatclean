// === banners — id-kind logical config (gacha) ===
//
// A gacha BANNER: price (in coins, single/ten), per-rarity roll weights, pity floors, and an optional
// featured hero pool. `displayName` is the slug. Presentation (name/sub/theme/face art) lives in
// UIConfig / assets, keyed by id. Currency + pool + rarity refs are by config id/key.
import { z } from 'zod';
import { zConfig, configRef, stringConfigRef, configRecord } from '@bishop/config-registry';

export const zBannerConfig = zConfig
  .extend({
    currencyConfigId: configRef('resources').describe('Resource the pull is priced in (→ resources; coins).'),
    cost: z.number().int().positive().describe('Single-pull cost in the banner currency.'),
    ten: z.number().int().positive().describe('Ten-pull cost (discount baked in) in the banner currency.'),
    limited: z.boolean().optional().describe('True = a time-limited/seasonal banner.'),
    weights: configRecord('rarities', 'key', z.number()).describe('Per-rarity roll weights + gamut (present keys define the floor). Map keys → rarities.'),
    pity: z.array(z.object({
      rarityKey: stringConfigRef('rarities', 'key').describe('The rarity this pity floor guarantees (→ rarities.key).'),
      max: z.number().int().positive().describe('Pulls without this rarity before it is forced.'),
    }).strict()).describe('Pity floors, evaluated per pull.'),
    heroPoolConfigIds: z.array(configRef('heroes')).optional().describe('Featured/curated hero pool (→ heroes); omit = the full roster.'),
  })
  .strict();
