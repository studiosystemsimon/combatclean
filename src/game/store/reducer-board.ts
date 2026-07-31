// === reducer slice: board — merge-board interactions (generator tap, move / merge / swap) ===
// Bodies moved verbatim from the former monolithic reducer switch. Orchestrates board + merge +
// generator + energy + battle-limit-energy; emits pure-data VFX events on state.fx.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Board from '../board/board.ts';
import * as Merge from '../merge/merge.ts';
import * as Energy from '../energy/energy.ts';
import * as Gen from '../generator/generator.ts';
import * as Battle from '../combat/battle.ts';
import { rng } from '../sim-random.ts';
import { buildMinigameLaunch } from '../minigame/context.ts';
import { A } from './actions.ts';

type S = any;
type Act = any;

export const boardHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.TAP_GENERATOR]: (state, action) => {
    const cell = state.board[action.index];
    if (!cell || cell.kind !== 'generator') return state;
    const cost = Gen.generatorCost(cell.genId);
    const energyNow = Energy.regen(state.energy, action.now);
    if (!Energy.canSpend(energyNow, cost)) return state;
    const empty = Board.firstEmptyIndex(state.board);
    if (empty < 0) return state;
    const level = Gen.rollDropLevel(cell.genId, cell.level, rng);
    const chain = Gen.generatorChain(cell.genId);
    let id = state.nextId;
    const board = Board.withCell(state.board, empty, Board.makeItem(id++, chain, level));
    const energy = Energy.spend(energyNow, cost, action.now);
    const fx = [...state.fx, { id: id++, type: 'generatorDrop' }];
    return { ...state, board, energy, fx, nextId: id, now: action.now };
  },
  [A.MOVE_OR_MERGE]: (state, action) => {
    const { from, to } = action;
    if (from === to) return state;
    const a = state.board[from]; if (!a) return state;
    const b = state.board[to];
    if (a.kind === 'generator') {
      if (b === null) { // relocate to an empty cell
        let gb = Board.withCell(state.board, to, a); gb = Board.withCell(gb, from, null);
        return { ...state, board: gb };
      }
      if (Merge.canMergeGenerator(a, b)) { // two same-generator, same-level tiles → next level
        let id = state.nextId;
        const merged = Board.makeGenerator(id++, a.genId, a.level + 1);
        let board = Board.withCell(state.board, to, merged); board = Board.withCell(board, from, null);
        const fx = [...state.fx, { id: id++, type: 'merge', tier: a.level + 1 }]; // shared merge burst + haptic
        return { ...state, board, nextId: id, fx };
      }
      // Otherwise SWAP: a generator can switch places with the target — a tile, or a generator that
      // ISN'T a same-level mergeable twin (that case merged above). A cobweb (locked) item stays
      // immovable, matching the item-drag rule below — it's freed only by merging a matching tile.
      if (b.kind === 'item' && b.locked) return state;
      let board = Board.withCell(state.board, to, a); board = Board.withCell(board, from, b);
      return { ...state, board };
    }
    if (a.kind !== 'item') return state;
    if (a.locked) return state;
    if (b === null) {
      let board = Board.withCell(state.board, to, a); board = Board.withCell(board, from, null);
      return { ...state, board };
    }
    if (Merge.canMergeSpecial(a, b)) {
      // Two SPECIAL (S) tiles merged → arm the screen-crumble TRANSITION (data only). Both tiles are
      // consumed now; the always-mounted <ScreenTransition> overlay plays the chaos-orb cinematic over
      // the live board and, at the POP apex, launches the minigame via the real system (SET_MINIGAME),
      // then reveals it as the screen shatters. The minigame is picked at RANDOM from the data-driven
      // pool (C.MINIGAME.pool) with a STANDARD context (current zone enemies/scenery + current squad).
      // fx is NOT cleared: FxLayer stays mounted during the charge so combat VFX keep flowing underneath.
      let board = Board.withCell(state.board, to, null); board = Board.withCell(board, from, null);
      return { ...state, board, transition: { minigame: buildMinigameLaunch(state, rng) } };
    }
    if (Merge.canMerge(a, b)) {
      let id = state.nextId;
      const tier = a.level + 1;
      const merged = Board.makeItem(id++, a.chain, tier);
      let board = Board.withCell(state.board, to, merged); board = Board.withCell(board, from, null);
      // Tier-mergeMinTier+ merges are a LIMIT-energy source (alongside orders): grant to the
      // lowest-charged heroes (count + amount scale with tier) and fly a charge mote to each.
      const heroes = Battle.grantMergeEnergy(state.battle.heroes, tier);
      const chargedIds = heroes.filter((h: any, i: number) => (h.limitEnergy || 0) !== (state.battle.heroes[i].limitEnergy || 0)).map((h: any) => h.id);
      const fx = [...state.fx, { id: id++, type: 'merge', tier },
        ...(chargedIds.length ? [{ id: id++, type: 'limitCharge', heroIds: chargedIds, cell: to, tier }] : [])];
      return { ...state, board, nextId: id, fx, battle: { ...state.battle, heroes } };
    }
    // Cobwebbed (locked) tiles can't be displaced by a swap either — dropping a non-matching tile
    // onto one is a no-op (they're freed only by merging a MATCHING tile onto them, handled above).
    if (b.kind !== 'item' || b.locked) return state;
    let board = Board.withCell(state.board, to, a); board = Board.withCell(board, from, b);
    return { ...state, board };
  },
};
