// === generator — weighted drop rolls (ported from MergeCombat model/generator.js) ===
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';

export const generatorChain = (genId: string) => C.GENERATORS[genId].chain;
export const generatorCost = (genId: string) => C.GENERATORS[genId].energyCost;

export const rollDropLevel = (genId: string, rng: Rng): number => {
  const drops = C.GENERATORS[genId].drops;
  const total = drops.reduce((sum: number, d: any) => sum + d.weight, 0);
  let r = rng() * total;
  for (const d of drops) { if (r < d.weight) return d.level; r -= d.weight; }
  return drops[drops.length - 1].level;
};
