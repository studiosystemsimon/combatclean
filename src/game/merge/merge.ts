// === merge — merge legality (ported from MergeCombat model/merge.js) ===
import { C } from '../content.ts';
import { maxGenLevel } from '../generator/generator.ts';
import type { BoardCell } from '../types.ts';

export const maxLevel = (chain: string) => C.CHAINS[chain].tiers - 1;
export const isMaxed = (item: BoardCell) => !!item && item.kind === 'item' && item.level >= maxLevel(item.chain);
export const canMerge = (a: BoardCell, b: BoardCell) =>
  !!a && !!b && a.kind === 'item' && b.kind === 'item' && a.chain === b.chain && a.level === b.level && a.level < maxLevel(a.chain);

// Generators merge the same way merge items do: two same-generator, same-level tiles (below the
// generator's max level) combine into one of the next level. Generators are 1-based (1..maxGenLevel).
export const canMergeGenerator = (a: BoardCell, b: BoardCell) =>
  !!a && !!b && a.kind === 'generator' && b.kind === 'generator' && a.genId === b.genId && a.level === b.level && a.level < maxGenLevel(a.genId);
