// === merge — merge legality (ported from MergeCombat model/merge.js) ===
import { C } from '../content.ts';
import { maxGenLevel } from '../generator/generator.ts';
import type { BoardCell } from '../types.ts';

// SPECIAL (S) tiles carry chain 'special', which has no CHAINS ladder — return 0 (not a crash) so any
// caller (canMerge, isMaxed, Board.jsx's best-merge hint) safely treats an S-tile as non-chain-mergeable.
export const maxLevel = (chain: string) => { const c = C.CHAINS[chain]; return c ? c.tiers - 1 : 0; };
export const isMaxed = (item: BoardCell) => !!item && item.kind === 'item' && item.level >= maxLevel(item.chain);
// Normal chain-item merge. SPECIAL (S) tiles are excluded here (their chain has no ladder — a maxLevel
// lookup would fault) — two S-tiles merging is handled separately (→ minigame) in the reducer.
export const canMerge = (a: BoardCell, b: BoardCell) =>
  !!a && !!b && a.kind === 'item' && b.kind === 'item' && !a.special && !b.special && a.chain === b.chain && a.level === b.level && a.level < maxLevel(a.chain);

// Two SPECIAL (S) tiles → mergeable into a minigame trigger (level-agnostic; both must be special items).
export const canMergeSpecial = (a: BoardCell, b: BoardCell) =>
  !!a && !!b && a.kind === 'item' && b.kind === 'item' && !!a.special && !!b.special;

// Generators merge the same way merge items do: two same-generator, same-level tiles (below the
// generator's max level) combine into one of the next level. Generators are 0-based (0..maxGenLevel),
// mirroring item tiers.
export const canMergeGenerator = (a: BoardCell, b: BoardCell) =>
  !!a && !!b && a.kind === 'generator' && b.kind === 'generator' && a.genId === b.genId && a.level === b.level && a.level < maxGenLevel(a.genId);
