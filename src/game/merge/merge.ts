// === merge — merge legality (ported from MergeCombat model/merge.js) ===
import { C } from '../content.ts';
import type { BoardCell } from '../types.ts';

export const maxLevel = (chain: string) => C.CHAINS[chain].tiers - 1;
export const isMaxed = (item: BoardCell) => !!item && item.kind === 'item' && item.level >= maxLevel(item.chain);
export const canMerge = (a: BoardCell, b: BoardCell) =>
  !!a && !!b && a.kind === 'item' && b.kind === 'item' && a.chain === b.chain && a.level === b.level && a.level < maxLevel(a.chain);
