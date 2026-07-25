// === orders — roll/match/reroll (ported from MergeCombat model/orders.js) ===
// Reward RARITY rolled from the current zone's rarity table (passed in). Requested items sized so the
// tile build-cost (Σ costPerTierBase^tier) lands in that rarity band. Reroll biases downward. rng injected.
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';
import type { BoardCell, Order, OrderItem } from '../types.ts';

const randInt = (min: number, max: number, rng: Rng) => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(arr: T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

const tileCost = (level: number) => Math.pow(C.ORDER_CONFIG.costPerTierBase, level);
export const tileTotal = (items: OrderItem[]) => items.reduce((s, it) => s + tileCost(it.level), 0);

const rollWeighted = (weights: Record<string, number>, rng: Rng): string => {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let x = rng() * total;
  for (const k of keys) { if ((x -= weights[k]) <= 0) return k; }
  return keys[0];
};

export const rerollRarity = (cur: string, rng: Rng): string => {
  const ci = C.GEAR_RARITY_ORDER.indexOf(cur);
  const w: Record<string, number> = {};
  C.GEAR_RARITY_ORDER.forEach((r: string, i: number) => {
    w[r] = i < ci ? (i === ci - 1 ? C.ORDER_REROLL.downNear : C.ORDER_REROLL.downFar) : i === ci ? C.ORDER_REROLL.same : C.ORDER_REROLL.up;
  });
  return rollWeighted(w, rng);
};

export const rollOrder = (id: number, rng: Rng, weights: Record<string, number>, forcedRarity: string | null = null): Order => {
  const rarity = forcedRarity || rollWeighted(weights, rng);
  const r = rng();
  const n = r < C.ORDER_CONFIG.itemCount.one ? 1 : r < C.ORDER_CONFIG.itemCount.two ? 2 : C.ORDER_CONFIG.itemCount.max;
  const [dlo, dhi] = C.ORDER_DOMINANT_TIER[rarity];
  const items: OrderItem[] = [];
  const c0 = pick(C.ORDER_CHAINS, rng);
  items.push({ chain: c0, level: Math.min(randInt(dlo, dhi, rng), C.CHAINS[c0].tiers - 1) });
  for (let i = 1; i < n; i++) {
    const c = pick(C.ORDER_CHAINS, rng);
    items.push({ chain: c, level: randInt(0, Math.min(C.ORDER_CONFIG.fillerMaxLevel, C.CHAINS[c].tiers - 1), rng) });
  }
  return { id, items, difficulty: tileTotal(items), rarity };
};

export const findMatchCells = (board: BoardCell[], order: Order): number[] | null => {
  const used = new Set<number>();
  const cells: number[] = [];
  for (const it of order.items) {
    const idx = board.findIndex((c, i) => !used.has(i) && c && c.kind === 'item' && c.chain === it.chain && c.level === it.level);
    if (idx < 0) return null;
    used.add(idx);
    cells.push(idx);
  }
  return cells;
};
export const canFulfill = (board: BoardCell[], order: Order) => findMatchCells(board, order) !== null;
