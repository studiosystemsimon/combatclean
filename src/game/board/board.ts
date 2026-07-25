// === board — flat merge-grid cells (ported from MergeCombat model/board.js) ===
import { C } from '../content.ts';
import type { BoardCell, BoardItem, BoardGenerator } from '../types.ts';

export const cellCount = () => C.BOARD.cols * C.BOARD.rows;
export const emptyBoard = (): BoardCell[] => new Array(cellCount()).fill(null);
export const makeItem = (id: number, chain: string, level: number, locked = false): BoardItem => ({ id, kind: 'item', chain, level, locked });
export const makeGenerator = (id: number, genId: string, level = 1): BoardGenerator => ({ id, kind: 'generator', genId, level });
export const firstEmptyIndex = (board: BoardCell[]) => board.indexOf(null);
export const isBoardFull = (board: BoardCell[]) => board.indexOf(null) === -1;
export const withCell = (board: BoardCell[], index: number, value: BoardCell): BoardCell[] => { const next = board.slice(); next[index] = value; return next; };
