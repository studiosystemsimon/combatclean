// === board — flat merge-grid cells (ported from MergeCombat model/board.js) ===
import { C } from '../content.ts';
import type { BoardCell, BoardItem, BoardGenerator } from '../types.ts';

export const cellCount = () => C.BOARD.cols * C.BOARD.rows;
export const emptyBoard = (): BoardCell[] => new Array(cellCount()).fill(null);
export const makeItem = (id: number, chain: string, level: number, locked = false): BoardItem => ({ id, kind: 'item', chain, level, locked });
// SPECIAL (S) tile — dropped by a fulfilled special order. Not a chain item (chain 'special' is never an
// order-requestable chain), never locked. Two of these merged together trigger a minigame.
export const makeSpecialTile = (id: number): BoardItem => ({ id, kind: 'item', chain: 'special', level: 0, locked: false, special: true });
export const makeGenerator = (id: number, genId: string, level = 0): BoardGenerator => ({ id, kind: 'generator', genId, level });
export const firstEmptyIndex = (board: BoardCell[]) => board.indexOf(null);
export const isBoardFull = (board: BoardCell[]) => board.indexOf(null) === -1;
export const withCell = (board: BoardCell[], index: number, value: BoardCell): BoardCell[] => { const next = board.slice(); next[index] = value; return next; };

// Where a newly-ADDED tile should land: prefer any EMPTY cell; if the board is full, replace the
// LOWEST-TIER ACTIVE tile — an UNLOCKED item (never a generator, never a cobwebbed/locked tile).
// Returns -1 only when the board is full of nothing but generators + cobwebs (nothing replaceable).
// Shared by the special-order S-tile drop AND the zone-win generator addition.
export const addTileIndex = (board: BoardCell[]): number => {
  const empty = board.indexOf(null);
  if (empty !== -1) return empty;
  let best = -1, bestLevel = Infinity;
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c && c.kind === 'item' && !c.locked && c.level < bestLevel) { bestLevel = c.level; best = i; }
  }
  return best;
};

// Add a tile via addTileIndex (empty → else replace the lowest-tier active item). Returns the board
// unchanged when nothing is replaceable (board full of generators + cobwebs).
export const addTileToBoard = (board: BoardCell[], tile: BoardCell): BoardCell[] => {
  const i = addTileIndex(board);
  return i < 0 ? board : withCell(board, i, tile);
};
