// === heroes — archetype + character stats (ported from MergeCombat model/heroes.js) ===
// Pure; reads the content singleton. A CHARACTER is an owned instance (cid, level, abilityLevel, fixed
// rarity); stats derive from the archetype + rarity + level + gear power via the EXPOSED HERO_COMBAT knobs.
import { C } from '../content.ts';
import type { Character } from '../types.ts';

export const heroDef = (hero: string) => C.HEROES[hero];
export const heroRarity = (char: Character | null | undefined) => (char && char.rarity) || null;
export const heroAbilityMul = (char: Character) => 1 + C.ABILITY_MUL_PER_LEVEL * (((char && char.abilityLevel) || 1) - 1);
export const ascensionsDone = (char: Character) => Math.max(0, ((char && char.abilityLevel) || 1) - 1);

export const heroMaxLevel = (char: Character) => {
  const base = C.LEVEL_CAP[heroRarity(char) || 'common'] || C.LEVEL_CAP.common;
  return base + C.HERO_UPGRADE.ascendLevelCapBonus * ascensionsDone(char);
};

export const newCharacter = (cid: string, hero: string, rarity: string): Character => ({ cid, hero, level: 1, abilityLevel: 1, rarity });

export const heroStats = (hero: string, char: Character | null, ordersCompleted: number, gearPow = 0) => {
  const def = C.HEROES[hero];
  const level = (char && char.level) ?? 1;
  const rarMul = C.RARITY_STAT_MUL[heroRarity(char) || def.rarity || 'common'] || 1;
  const orderMul = 1 + C.BATTLE.orderPowerBonus * ordersCompleted;
  const atkMul = 1 + C.HERO_LEVEL.atkPerLevel * (level - 1);
  const hpMul = 1 + C.HERO_LEVEL.hpPerLevel * (level - 1);
  const defMul = 1 + C.HERO_LEVEL.defPerLevel * (level - 1);
  return {
    atk: Math.max(1, Math.round((def.baseAtk * atkMul * rarMul + gearPow * C.HERO_COMBAT.gearAtkWeight) * orderMul)),
    maxHp: Math.max(1, Math.round((def.baseHp * hpMul * rarMul + gearPow * C.HERO_COMBAT.gearHpWeight) * orderMul)),
    def: Math.max(0, Math.round((def.baseDef * defMul * rarMul + gearPow * C.HERO_COMBAT.gearDefWeight) * orderMul)),
  };
};

export const heroPower = (hero: string, char: Character | null, ordersCompleted: number, gearPow = 0) => {
  const s = heroStats(hero, char, ordersCompleted, gearPow);
  return s.atk * C.HERO_COMBAT.powerAtkWeight + Math.round(s.maxHp / C.HERO_COMBAT.powerHpDivisor);
};

export const canAscendChar = (char: Character) => ascensionsDone(char) < C.HERO_UPGRADE.maxAscensions;
export const ascendChar = (char: Character): Character => canAscendChar(char) ? { ...char, abilityLevel: (char.abilityLevel || 1) + 1 } : char;
export const ascendCrystalRarity = (char: Character) => heroRarity(char);
export const hasAscendCrystals = (char: Character, crystals: Record<string, number>) => ((crystals && crystals[heroRarity(char) as string]) || 0) >= C.HERO_UPGRADE.ascendCrystalCost;
export const spendAscendCrystals = (crystals: Record<string, number>, char: Character) => {
  const r = heroRarity(char) as string;
  return { ...crystals, [r]: Math.max(0, ((crystals && crystals[r]) || 0) - C.HERO_UPGRADE.ascendCrystalCost) };
};
export const ownedHeroSet = (roster: Record<string, Character>) => new Set(Object.values(roster || {}).map((c) => c.hero));
export const copiesOfHero = (roster: Record<string, Character>, hero: string) => Object.values(roster || {}).filter((c) => c.hero === hero).length;
export const ascendSelection = (roster: Record<string, Character>, hero: string, powerOf: (cid: string) => number) => {
  const cids = Object.keys(roster || {}).filter((c) => roster[c].hero === hero);
  if (cids.length < 2) return null;
  let keepCid = cids[0], sacrificeCid = cids[0];
  for (const c of cids) {
    if (powerOf(c) > powerOf(keepCid)) keepCid = c;
    if (powerOf(c) < powerOf(sacrificeCid)) sacrificeCid = c;
  }
  if (keepCid === sacrificeCid) sacrificeCid = cids.find((c) => c !== keepCid) as string;
  return { keepCid, sacrificeCid };
};
