// === ftue — first-time-user-experience OVERRIDE layer (singleton) ===
//
// The FTUE is a DETACHABLE layer of overrides on top of gameplay: the sim reads these values through
// thin read-hooks ONLY while a fresh-save FTUE run is active (flags.ftueActive). Turn the flag off (or
// drop this config) and every hook falls through to vanilla gameplay — zero code change, no residue.
// Nothing here is tutorial COPY (that lives view-side in the coachmark beats) — only the gameplay
// VALUES the guided opening overrides.
import { z } from 'zod';
import { configRef, stringConfigRef } from '@bishop/config-registry';

export const zFtueConfig = z.object({
  enabledByDefault: z.boolean().describe('A fresh save activates the FTUE (sets flags.ftueActive). false → the layer is inert for everyone; gameplay runs normally.'),
  zoneEnemyCounts: z.array(z.number().int().min(1)).describe('Authored per-level enemy counts for ZONE 1 (index 0 = level 1). Overrides buildWave’s formula + the rest count-cap while active. The boss level is unaffected.'),
  firstEnemyConfigIds: z.array(configRef('enemies')).describe('Pinned archetypes for the first levels (index 0 = L1, 1 = L2, …) so early levels teach one DISTINCT enemy at a time (→ enemies). Beyond the list, the normal pool is used.'),
  firstOrderReward: z.enum(['gear', 'potion', 'special']).describe('The forced reward type of the OPENING order (the keystone Limit Potion).'),
  firstOrderChainKey: stringConfigRef('chains', 'key').describe('The chain the opening order requests — = the tile the guided forge+merge produces (→ chains.key).'),
  firstOrderTier: z.number().int().min(0).describe('The 0-based tier the opening order requests (matches the guided merge result).'),
  secondOrderReward: z.enum(['gear', 'potion', 'special']).describe('The forced reward type of the SECOND order (the guided "good gear" reward). Normally "gear".'),
  secondOrderChainKey: stringConfigRef('chains', 'key').describe('The chain the second order requests — the tile the player merges to fulfil it (→ chains.key).'),
  secondOrderTier: z.number().int().min(0).describe('The 0-based tier the second order requests.'),
  secondOrderGearSlot: stringConfigRef('gearSlots', 'key').describe('The gear SLOT the forced second-order reward grants (→ gearSlots.key), e.g. armor.'),
  secondOrderGearRarity: stringConfigRef('gearRarities', 'key').describe('The rarity of the forced second-order gear reward (→ gearRarities.key), e.g. epic — capped at the rolled piece’s maxRarity.'),
  summonAtLevel: z.number().int().min(1).describe('The battle level at which the guided summon is armed ("things are getting tough — hire a hero").'),
  specialsUnlockAtLevel: z.number().int().min(1).describe('The battle level at which SPECIAL orders unlock during the FTUE (flags.specialOrders flips true on reaching it). Until then specials are suppressed from the opening roll + gap-fills.'),
  firstPullHeroConfigId: configRef('heroes').describe('The PREDETERMINED summon hero — a fixed pull, not a roll (→ heroes). Granted free the first time; extra pulls roll normally. Its limit break should be AOE so the guided "clear the screen" beat lands.'),
}).strict();
