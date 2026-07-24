// Barrel: zone list the view reads — logical (C.ZONES) + presentation (name/biome/keyArt) re-combined
// into the exact shape MergeCombat's view expects. `zoneForLevel` here returns the MERGED zone (with
// presentation) for the view — distinct from the sim's model selector (game/map), which stays logical.
import { C } from '../game/content.ts';
import { uiZone } from './_ui.js';
import { zoneIndexForLevel } from '../game/map/map.ts';

export const ZONES = C.ZONES.map((z) => {
  const u = uiZone(z.id);
  return {
    ...z, ...u,
    name: u.name ?? z.id,
    nameKey: z.id,               // STRINGS.zones[nameKey] — slug key, matches the loc table
    keyArt: u.iconAssetId,       // asset key for the biome backdrop
    biome: u.biome,              // { from, to, accent } presentation colours
  };
});

export const zoneForLevel = (level) => ZONES[zoneIndexForLevel(level)] || ZONES[ZONES.length - 1];
