// === map — zone/node/idle derivation from the single battle level (ported from MergeCombat model/map.js) ===
// Pure; reads the content singleton. Everything is DERIVED from `level` — no map state.
import { C } from '../content.ts';

const clampLevel = (level: number) => Math.max(1, Math.floor(level) || 1);

export const zoneIndexForLevel = (level: number) => Math.min(C.ZONES.length - 1, Math.floor((clampLevel(level) - 1) / C.ZONE_LEN));
export const zoneForLevel = (level: number) => C.ZONES[zoneIndexForLevel(level)];
export const zoneStartLevel = (idx: number) => idx * C.ZONE_LEN + 1;
export const zoneBossLevel = (idx: number) => (idx + 1) * C.ZONE_LEN;
export const isBossLevel = (level: number) => clampLevel(level) % C.ZONE_LEN === 0;
export const levelInZone = (level: number) => ((clampLevel(level) - 1) % C.ZONE_LEN) + 1;

export const nodeTypeForLevel = (level: number): string => {
  if (isBossLevel(level)) return 'boss';
  return C.NODE.layout[levelInZone(level)] || 'combat';
};
export const isEliteLevel = (level: number) => nodeTypeForLevel(level) === 'elite';
export const isRestLevel = (level: number) => nodeTypeForLevel(level) === 'rest';
export const nodeRewardMul = (level: number) => C.NODE.rewardMul[nodeTypeForLevel(level)] ?? 1;

export const crystalForLevel = (level: number) => zoneForLevel(level).crystal;
export const itemsForLevel = (level: number) => zoneForLevel(level).items || [];

export const afkRatesForLevel = (level: number) => {
  const z = zoneIndexForLevel(level);
  return {
    coinsPerHr: C.AFK.coinsPerHr + C.AFK.coinsPerZone * z,
    heroXpPerHr: C.AFK.heroXpPerHr + C.AFK.heroXpPerZone * z,
    gearXpPerHr: C.AFK.gearXpPerHr + C.AFK.gearXpPerZone * z,
  };
};
export const afkEarnings = (furthestLevel: number, elapsedMs: number) => {
  const ms = Math.max(0, Math.min(elapsedMs || 0, C.AFK.maxOfflineMs));
  const hrs = ms / 3600000;
  const r = afkRatesForLevel(furthestLevel);
  return { ms, coins: Math.floor(r.coinsPerHr * hrs), heroXp: Math.floor(r.heroXpPerHr * hrs), gearXp: Math.floor(r.gearXpPerHr * hrs) };
};
