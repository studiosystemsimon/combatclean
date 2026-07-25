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
    unlocksGeneratorKeys: z.array(stringConfigRef('generators', 'key')).default([]).describe('Generators UNLOCKED when this area is FIRST completed (→ generators.key). Empty = none. Systemic: any number of generators per zone; the unlocked set drives board placement + order eligibility.'),
    // Biome colour tint (from/to/accent) is presentation → the UI zone entry, not here.
  })
  .strict();
