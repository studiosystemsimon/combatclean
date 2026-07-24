// === resources — id-kind logical config (the id-keyed wallet) ===
//
// A RESOURCE is anything spendable/grantable: coins, the XP pools (heroXp/gearXp), the energy gate,
// and the six ascension crystals (one per hero rarity). The numeric config id is the identity used in
// ALL pricing AND the account wallet. `displayName` is the slug (asset/editor/analytics label only) —
// gameplay logic NEVER keys on it. Display (name/symbol/colour/icon) lives in the resources UIConfig.
import { z } from 'zod';
import { zConfig, stringConfigRef } from '@bishop/config-registry';

export const zResourceConfig = zConfig
  .extend({
    wallet: z.boolean().optional().describe('True = a persistent account wallet balance.'),
    premium: z.boolean().optional().describe('True = premium/IAP currency.'),
    inRun: z.boolean().optional().describe('True = in-run only; resets each run.'),
    consumable: z.boolean().optional().describe('True = a consumable token (excluded from the currency HUD bar).'),
    crystalRarityKey: stringConfigRef('rarities', 'key').optional().describe('For ascension-crystal resources: the hero-rarity tier this crystal ascends (→ rarities.key).'),
  })
  .strict();
