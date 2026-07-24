// === progression — hero-level cost curve (ported from MergeCombat model/progression.js) ===
import { C } from '../content.ts';
import { heroMaxLevel } from '../heroes/heroes.ts';
import type { Character } from '../types.ts';

export const heroLevelCost = (level: number) => Math.round(C.HERO_LEVEL.xpBase * Math.pow(C.HERO_LEVEL.xpGrowth, level - 1));
export const heroAtMax = (char: Character) => char.level >= heroMaxLevel(char);
export const canLevelHero = (char: Character, heroXpPool: number) => !heroAtMax(char) && heroXpPool >= heroLevelCost(char.level);

export const levelUpHeroMax = (char: Character, heroXpPool: number) => {
  const cap = heroMaxLevel(char);
  let level = char.level, xp = heroXpPool, gained = 0, guard = 0;
  while (level < cap && xp >= heroLevelCost(level) && guard++ < 1000) { xp -= heroLevelCost(level); level += 1; gained += 1; }
  return { level, spent: heroXpPool - xp, gained };
};
