// === orders — roll/match/reroll (ported from MergeCombat model/orders.js) ===
// Reward RARITY rolled from the current zone's rarity table (passed in). Requested items sized so the
// tile build-cost (Σ costPerTierBase^tier) lands in that rarity band. Reroll re-rolls the ITEMS but keeps
// the order's rarity + special-ness, and is allowed once per order. rng injected.
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';
import type { BoardCell, Order, OrderItem, OrderReward } from '../types.ts';

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

// `eligibleChains` restricts which chains an order may request — the caller passes the chains whose
// generator is currently UNLOCKED, so no order asks for an item the player can't yet produce (e.g. no
// magic orders until the magic generator is unlocked). Defaults to the full order-chain list.
// The order's reward type, with backward-compat for the legacy `special` boolean (old saves / in-flight
// orders predating the reward enum). Absent → the default gear chest.
export const orderReward = (o: Order): OrderReward => o.reward || (o.special ? 'special' : 'gear');

export const rollOrder = (id: number, rng: Rng, weights: Record<string, number>, eligibleChains: string[] = C.ORDER_CHAINS, forcedRarity: string | null = null, forcedReward: OrderReward | null = null, allowSpecial = true, allowPotion = true): Order => {
  const chains = eligibleChains.length ? eligibleChains : C.ORDER_CHAINS;
  const rarity = forcedRarity || rollWeighted(weights, rng);
  const r = rng();
  const n = r < C.ORDER_CONFIG.itemCount.one ? 1 : r < C.ORDER_CONFIG.itemCount.two ? 2 : C.ORDER_CONFIG.itemCount.max;
  const [dlo, dhi] = C.ORDER_DOMINANT_TIER[rarity];
  const items: OrderItem[] = [];
  const c0 = pick(chains, rng);
  items.push({ chain: c0, level: Math.min(randInt(dlo, dhi, rng), C.CHAINS[c0].tiers - 1) });
  for (let i = 1; i < n; i++) {
    const c = pick(chains, rng);
    items.push({ chain: c, level: randInt(0, Math.min(C.ORDER_CONFIG.fillerMaxLevel, C.CHAINS[c].tiers - 1), rng) });
  }
  // REWARD TYPE (rolled by chance): a limit POTION (fills limit energy), a SPECIAL S-tile, or the default
  // gear chest. POTION is gated by `allowPotion` (only ever ONE limit order active) and SPECIAL by
  // `allowSpecial` (the FTUE unlock flag) — locked → that type can never roll.
  // A REROLL forces the source order's type (forcedReward) so it survives the reroll.
  const reward: OrderReward = forcedReward != null ? forcedReward
    : (allowPotion && rng() < (C.ORDER_CONFIG.potionChance || 0)) ? 'potion'
      : (allowSpecial && rng() < (C.ORDER_CONFIG.specialChance || 0)) ? 'special'
        : 'gear';
  return { id, items, difficulty: tileTotal(items), rarity, reward };
};

export const findMatchCells = (board: BoardCell[], order: Order): number[] | null => {
  const used = new Set<number>();
  const cells: number[] = [];
  for (const it of order.items) {
    // Cobwebbed (locked) tiles are ineligible for orders — they can never be consumed to fulfil one.
    const idx = board.findIndex((c, i) => !used.has(i) && c && c.kind === 'item' && !c.locked && c.chain === it.chain && c.level === it.level);
    if (idx < 0) return null;
    used.add(idx);
    cells.push(idx);
  }
  return cells;
};
export const canFulfill = (board: BoardCell[], order: Order) => findMatchCells(board, order) !== null;

// Display order (view-only, pure), left→right: COMPLETABLE (rarest furthest left) → SPECIAL (not yet
// completable) → STANDARD (not yet completable) → PENDING (arrival timers) last. A FULFILLING order stays
// pinned in the completable lead group so its tile holds position through the completion animation
// (instead of sliding away) before it's removed. Does not mutate state.
export const displayOrders = (orders: Order[], board: BoardCell[]): Order[] => {
  const rank = (r: string) => C.GEAR_RARITY_ORDER.indexOf(r);
  // Stacking, generic by order TYPE: [completable] [special] [limit] [standard] [pending].
  const lead: Order[] = [], special: Order[] = [], limit: Order[] = [], standard: Order[] = [], pending: Order[] = [];
  for (const o of orders) {
    if (o.pending) { pending.push(o); continue; }
    if (o.fulfilling || canFulfill(board, o)) { lead.push(o); continue; } // completable (any reward type)
    const r = orderReward(o);
    if (r === 'special') special.push(o);
    else if (r === 'potion') limit.push(o); // limit-POTION orders
    else standard.push(o); // gear (default)
  }
  lead.sort((a, b) => rank(b.rarity) - rank(a.rarity));
  return [...lead, ...special, ...limit, ...standard, ...pending];
};
