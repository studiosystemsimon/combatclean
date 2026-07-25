// === generator — weighted drop rolls (ported from MergeCombat model/generator.js) ===
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';

export const generatorChain = (genId: string) => C.GENERATORS[genId].chain;
export const generatorCost = (genId: string) => C.GENERATORS[genId].energyCost;
// Generator levels are 1-based; max level = the number of authored per-level drop tables.
export const maxGenLevel = (genId: string): number => C.GENERATORS[genId].dropsByLevel.length;

export const rollDropLevel = (genId: string, genLevel: number, rng: Rng): number => {
  const tables = C.GENERATORS[genId].dropsByLevel;
  const drops = tables[Math.min(Math.max(genLevel || 1, 1), tables.length) - 1]; // `|| 1` = legacy/undefined-safe
  const total = drops.reduce((sum: number, d: any) => sum + d.weight, 0);
  let r = rng() * total;
  for (const d of drops) { if (r < d.weight) return d.level; r -= d.weight; }
  return drops[drops.length - 1].level;
};
