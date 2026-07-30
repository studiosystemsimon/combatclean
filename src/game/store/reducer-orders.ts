// === reducer slice: orders — fulfil / fill-gap / empty / reroll ===
// Bodies moved verbatim from the former monolithic reducer switch. Orchestrates orders + board +
// battle-order-energy + gear reward + map; emits pure-data VFX events on state.fx.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Board from '../board/board.ts';
import * as Orders from '../orders/orders.ts';
import * as Battle from '../combat/battle.ts';
import * as Gear from '../gear/gear.ts';
import * as Map from '../map/map.ts';
import { C } from '../content.ts';
import { rng } from '../sim-random.ts';
import { A } from './actions.ts';
import { orderChainsFor } from './reducer-helpers.ts';

type S = any;
type Act = any;

export const ordersHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.FULFILL_ORDER]: (state, action) => {
    const order = state.orders.find((o: any) => o.id === action.orderId);
    if (!order || order.pending || order.fulfilling) return state;
    const cells = Orders.findMatchCells(state.board, order);
    if (!cells) return state;
    let id = state.nextId;
    let board = state.board;
    for (const idx of cells) board = Board.withCell(board, idx, null);
    const oldC = state.ordersCompleted; const newC = oldC + 1;
    const ratio = (1 + C.BATTLE.orderPowerBonus * newC) / (1 + C.BATTLE.orderPowerBonus * oldC);
    const bHeroes = Battle.grantOrderEnergy(state.battle.heroes.map((h: any) => ({
      ...h, atk: Math.max(1, Math.round(h.atk * ratio)), maxHp: Math.max(1, Math.round(h.maxHp * ratio)), hp: Math.max(1, Math.round(h.hp * ratio)),
    })));
    const reward = Orders.orderReward(order);
    if (reward === 'special') {
      // SPECIAL ORDER: reward = an S-tile dropped on the board (empty → else replace lowest active),
      // NOT a gear chest. The slot resolves straight to a fresh pending order (no chest choreography —
      // so a refresh can't strand it). ordersCompleted / power / limit-energy are granted like any order.
      board = Board.addTileToBoard(board, Board.makeSpecialTile(id++));
      const orders = [...state.orders.filter((o: any) => o.id !== order.id), { id: id++, pending: true, dur: C.ORDER_CONFIG.arrivalMs }];
      const fx = [...state.fx, { id: id++, type: 'limitCharge', orderId: order.id, heroIds: bHeroes.map((h: any) => h.id) }];
      return { ...state, board, orders, ordersCompleted: newC, battle: { ...state.battle, heroes: bHeroes }, nextId: id, fx };
    }
    if (reward === 'potion') {
      // LIMIT POTION: reward = a big slug of LIMIT ENERGY (no gear chest) — fills potionFrac of each living
      // hero's limit charge. The slot resolves straight to a fresh pending order (no chest choreography →
      // refresh-safe); the limitCharge fx flies motes into the limit bars so the surge reads.
      const chargedHeroes = Battle.grantLimitPotion(bHeroes, C.BATTLE.limitEnergy.potionFrac);
      const orders = [...state.orders.filter((o: any) => o.id !== order.id), { id: id++, pending: true, dur: C.ORDER_CONFIG.arrivalMs }];
      const fx = [...state.fx, { id: id++, type: 'limitCharge', orderId: order.id, heroIds: chargedHeroes.map((h: any) => h.id) }];
      return { ...state, orders, ordersCompleted: newC, battle: { ...state.battle, heroes: chargedHeroes }, nextId: id, fx };
    }
    const gid = id++;
    const zoneItems = Map.itemsForLevel(state.battle.level);
    let g: any = null;
    if (zoneItems.length && rng() < C.UNIQUE_DROP.chance) g = Gear.makeUnique(String(gid), zoneItems[Math.floor(rng() * zoneItems.length)], rng);
    if (!g) g = Gear.rollGear(String(gid), order.rarity || Gear.chestRarityForDifficulty(order.difficulty), rng);
    const gear = { ...state.gear, [gid]: g };
    const orders = state.orders.map((o: any) => (o.id === order.id ? { ...order, fulfilling: true } : o));
    const items = cells.map((c: number, i: number) => ({ cell: c, chain: order.items[i].chain }));
    const fx = [
      ...state.fx,
      { id: id++, type: 'orderChest', orderId: order.id, items, orderPt: action.orderPt || null, gear: { slot: g.slot, rarity: g.rarity } },
      { id: id++, type: 'limitCharge', orderId: order.id, heroIds: bHeroes.map((h: any) => h.id) },
    ];
    return { ...state, board, orders, gear, ordersCompleted: newC, battle: { ...state.battle, heroes: bHeroes }, nextId: id, fx };
  },
  [A.FILL_ORDER_GAP]: (state, action) => {
    const slot = state.orders.find((o: any) => o.id === action.orderId && o.pending);
    if (!slot) return state;
    let id = state.nextId;
    const weights = Map.zoneForLevel(state.battle.level).orderRarity;
    const eligibleChains = orderChainsFor(state.unlockedGenerators);
    const orders = state.orders.map((o: any) => (o.id === action.orderId ? Orders.rollOrder(id++, rng, weights, eligibleChains) : o));
    return { ...state, orders, nextId: id };
  },
  [A.EMPTY_ORDER]: (state, action) => {
    const target = state.orders.find((o: any) => o.id === action.orderId && o.fulfilling);
    if (!target) return state;
    let id = state.nextId;
    const rest = state.orders.filter((o: any) => o.id !== action.orderId);
    const pending = { id: id++, pending: true, dur: C.ORDER_CONFIG.arrivalMs };
    return { ...state, orders: [...rest, pending], nextId: id };
  },
  [A.REROLL_ORDER]: (state, action) => {
    const order = state.orders.find((o: any) => o.id === action.orderId);
    if (!order || order.pending || order.fulfilling || order.rerolled) return state; // reroll is once-only
    const weights = Map.zoneForLevel(state.battle.level).orderRarity;
    // Re-roll the ITEMS only: keep the order's rarity AND its reward type (potion stays potion, special
    // stays special, gear stays gear). Mark it rerolled so the reroll option then disappears.
    const rolled = { ...Orders.rollOrder(order.id, rng, weights, orderChainsFor(state.unlockedGenerators), order.rarity, Orders.orderReward(order)), rerolled: true };
    const orders = state.orders.map((o: any) => (o.id === order.id ? rolled : o));
    return { ...state, orders };
  },
};
