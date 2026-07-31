// === reducer slice: heroes — swap, ascend, level-up, level-up-max ===
// Bodies moved verbatim from the former monolithic reducer switch. Orchestrates heroes (squad order /
// ascend / progression) + gear reattach + battle squad rescale.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Battle from '../combat/battle.ts';
import * as Prog from '../progression/progression.ts';
import * as Gear from '../gear/gear.ts';
import { heroPower, ascendChar, canAscendChar, ascendSelection } from '../heroes/heroes.ts';
import { A } from './actions.ts';
import { squadOf, battleStatsFor, rescaleHero } from './reducer-helpers.ts';

type S = any;
type Act = any;

export const heroesHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.SWAP_HEROES]: (state, action) => {
    const { a, b } = action;
    if (a === b) { console.log('[dragdbg] reducer SWAP_HEROES noop (a===b)', a); return state; } // TEMP
    const ia = state.order.indexOf(a); const ib = state.order.indexOf(b);
    if (ia < 0 || ib < 0) { console.log('[dragdbg] reducer SWAP_HEROES not-in-order', { a, b, ia, ib }); return state; } // TEMP
    const order = state.order.slice(); order[ia] = b; order[ib] = a;
    console.log('[dragdbg] reducer SWAP_HEROES ok', { a, b, ia, ib, newHead: order.slice(0, 6) }); // TEMP
    const squad = squadOf(order);
    const byId = Object.fromEntries(state.battle.heroes.map((h: any) => [h.id, h]));
    const statsFn = battleStatsFor(state.heroes, state.gear, state.ordersCompleted);
    const heroes = squad.map((hid: string) => byId[hid] || Battle.buildHeroes([hid], statsFn)[0]);
    return { ...state, order, battle: { ...state.battle, heroes } };
  },
  [A.ASCEND_HERO]: (state, action) => {
    const src = state.heroes[action.id];
    if (!src) return state;
    const powOfCid = (c: string) => heroPower(state.heroes[c].hero, state.heroes[c], state.ordersCompleted, Gear.heroGearPower(state.gear, c));
    const sel = ascendSelection(state.heroes, src.hero, powOfCid);
    if (!sel) return state;
    const keep = state.heroes[sel.keepCid];
    if (!canAscendChar(keep)) return state;
    const heroes = { ...state.heroes, [sel.keepCid]: ascendChar(keep) };
    delete heroes[sel.sacrificeCid];
    const order = state.order.filter((c: string) => c !== sel.sacrificeCid);
    let gear = state.gear;
    if (Object.values(state.gear).some((g: any) => g.equippedTo === sel.sacrificeCid)) {
      gear = {};
      for (const k in state.gear) gear[k] = state.gear[k].equippedTo === sel.sacrificeCid ? { ...state.gear[k], equippedTo: null } : state.gear[k];
    }
    const squad = squadOf(order);
    const statsFn = battleStatsFor(heroes, gear, state.ordersCompleted);
    const byId = Object.fromEntries(state.battle.heroes.map((h: any) => [h.id, h]));
    const battleHeroes = squad.map((c: string) => { const live = byId[c]; if (!live) return Battle.buildHeroes([c], statsFn)[0]; return c === sel.keepCid ? rescaleHero(live, statsFn(c)) : live; });
    return { ...state, heroes, order, gear, battle: { ...state.battle, heroes: battleHeroes } };
  },
  [A.LEVEL_UP_HERO]: (state, action) => {
    const h = state.heroes[action.id];
    if (!h || !Prog.canLevelHero(h, state.heroXp)) return state;
    const cost = Prog.heroLevelCost(h.level);
    const heroes = { ...state.heroes, [action.id]: { ...h, level: h.level + 1 } };
    let battle = state.battle;
    if (squadOf(state.order).includes(action.id)) {
      const statsFn = battleStatsFor(heroes, state.gear, state.ordersCompleted);
      battle = { ...battle, heroes: battle.heroes.map((bh: any) => (bh.id === action.id ? rescaleHero(bh, statsFn(bh.id)) : bh)) };
    }
    return { ...state, heroXp: state.heroXp - cost, heroes, battle };
  },
  [A.LEVEL_UP_HERO_MAX]: (state, action) => {
    const h = state.heroes[action.id];
    if (!h) return state;
    const { level, spent } = Prog.levelUpHeroMax(h, state.heroXp);
    if (level === h.level) return state;
    const heroes = { ...state.heroes, [action.id]: { ...h, level } };
    let battle = state.battle;
    if (squadOf(state.order).includes(action.id)) {
      const statsFn = battleStatsFor(heroes, state.gear, state.ordersCompleted);
      battle = { ...battle, heroes: battle.heroes.map((bh: any) => (bh.id === action.id ? rescaleHero(bh, statsFn(bh.id)) : bh)) };
    }
    return { ...state, heroXp: state.heroXp - spent, heroes, battle };
  },
};
