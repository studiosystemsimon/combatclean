// === zones — id-kind logical config (the map) ===
//
// A ZONE re-skins a segment of the single infinite battle ladder: which enemies spawn, the boss +
// accomplice, the order-reward rarity curve, the crystal tier, and the unique-item pool. `order` sets
// its position (the zone for a level is derived from it). `displayName` is the slug. Presentation
// (name + biome tint) + key art live in UIConfig / assets, keyed by id. Every cross-ref is by config id/key.
import { z } from 'zod';
import { zConfig, configRef, stringConfigRef, configRecord } from '@bishop/config-registry';

export const zZoneConfig = zConfig
  .extend({
    order: z.number().int().describe('Zone progression order (0-based; the zone for a level derives from this).'),
    enemyPoolConfigIds: z.array(configRef('enemies')).describe('Regular enemies that spawn here (→ enemies).'),
    bossConfigId: configRef('enemies').describe('The zone boss (→ enemies).'),
    accompliceConfigId: configRef('enemies').describe('The minion flanking/raised by the boss (→ enemies).'),
    crystalRarityKey: stringConfigRef('rarities', 'key').describe('Which ascension-crystal tier drops here (→ rarities.key).'),
    orderRarity: configRecord('gearRarities', 'key', z.number()).describe('Order reward-rarity weights (map keys → gearRarities).'),
    itemConfigIds: z.array(configRef('gearPieces')).describe('Zone unique gear pieces in the chest pool (→ gearPieces).'),
    rewardGenerators: z.array(z.object({
      generatorKey: stringConfigRef('generators', 'key').describe('Which generator (→ generators.key).'),
      level: z.number().int().min(0).default(0).describe('The EXACT 0-based level the awarded generator is placed at (hardcoded — never derived at runtime).'),
    })).default([]).describe('Generators AWARDED (placed on the board) on FIRST completion of this area, each at a SPECIFIC hardcoded level. A genuinely-new generator key also joins the unlocked set (order eligibility + boot placement); an already-unlocked key is still placed as a mergeable duplicate. The roster rotates magic→blade→range across zones.'),
    // Biome colour tint (from/to/accent) is presentation → the UI zone entry, not here.
  })
  .strict();
