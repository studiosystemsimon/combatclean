// === generator — weighted drop rolls (ported from MergeCombat model/generator.js) ===
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';

export const generatorChain = (genId: string) => C.GENERATORS[genId].chain;
export const generatorCost = (genId: string) => C.GENERATORS[genId].energyCost;
// Generator levels are 0-based (mirroring item tiers); max level = the top authored table index.
export const maxGenLevel = (genId: string): number => C.GENERATORS[genId].dropsByLevel.length - 1;

export const rollDropLevel = (genId: string, genLevel: number, rng: Rng): number => {
  const tables = C.GENERATORS[genId].dropsByLevel;
  const drops = tables[Math.min(Math.max(genLevel || 0, 0), tables.length - 1)]; // 0-based level = table index; legacy/undefined-safe
  const total = drops.reduce((sum: number, d: any) => sum + d.weight, 0);
  let r = rng() * total;
  for (const d of drops) { if (r < d.weight) return d.level; r -= d.weight; }
  return drops[drops.length - 1].level;
};
