// === reducer slice: gear — auto-equip/level, per-hero equip/level, fuse, equip-best, upgrade ===
// Bodies moved verbatim from the former monolithic reducer switch. Orchestrates gear operations +
// battle squad rescale (the equipped-power feeds hero stats).
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Gear from '../gear/gear.ts';
import { heroPower } from '../heroes/heroes.ts';
import { A } from './actions.ts';
import { battleStatsFor, rescaleBattle } from './reducer-helpers.ts';

type S = any;
type Act = any;

export const gearHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.AUTO_EQUIP]: (state) => {
    const ranked = [...state.order].sort((x: string, y: string) => heroPower(state.heroes[y].hero, state.heroes[y], state.ordersCompleted, 0) - heroPower(state.heroes[x].hero, state.heroes[x], state.ordersCompleted, 0));
    const gear = Gear.autoEquipAll(state.gear, ranked.map((cid: string) => ({ id: cid, cls: Gear.heroClassOf(state.heroes[cid].hero) })));
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.AUTO_LEVEL]: (state) => {
    const { gear, xp } = Gear.autoLevelAll(state.gear, state.gearXp);
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.AUTO_HERO]: (state, action) => {
    const hid = action.id; if (!state.heroes[hid]) return state;
    let gear = Gear.autoEquipHero(state.gear, hid, Gear.heroClassOf(state.heroes[hid].hero));
    const res = Gear.autoLevelHero(gear, hid, state.gearXp); gear = res.gear;
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, gearXp: res.xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.LEVEL_GEAR]: (state, action) => {
    const { gear, xp } = Gear.levelGear(state.gear, action.id, state.gearXp);
    if (gear === state.gear) return state;
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.EQUIP_ITEM]: (state, action) => {
    const g0 = state.gear[action.gearId]; const hc = state.heroes[action.heroId];
    if (!g0 || !hc || !Gear.canEquip(g0, Gear.heroClassOf(hc.hero))) return state; // piece must fit this class's slot (+ class match)
    const gear = Gear.equipItem(state.gear, action.gearId, action.heroId);
    if (gear === state.gear) return state;
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.LEVEL_ALL_ONE]: (state, action) => {
    const { gear, xp } = Gear.levelAllHeroOnce(state.gear, action.id, state.gearXp);
    if (xp === state.gearXp) return state;
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.LEVEL_ALL_MAX]: (state, action) => {
    const { gear, xp } = Gear.autoLevelHero(state.gear, action.id, state.gearXp);
    if (xp === state.gearXp) return state;
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.FUSE_GEAR]: (state, action) => {
    const src = state.gear[action.id];
    if (!src || !Gear.canFuse(state.gear, action.id)) return state;
    const cost = Gear.fuseCost(src.rarity);
    if (state.coins < cost) return state;
    const gear = Gear.fuseGear(state.gear, action.id);
    if (gear === state.gear) return state;
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, coins: state.coins - cost, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.EQUIP_BEST]: (state, action) => {
    const hid = action.id; if (!state.heroes[hid]) return state;
    const gear = Gear.autoEquipHero(state.gear, hid, Gear.heroClassOf(state.heroes[hid].hero));
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
  [A.UPGRADE_HERO]: (state, action) => {
    const hid = action.id; if (!state.heroes[hid]) return state;
    const { gear, xp } = Gear.autoLevelHero(state.gear, hid, state.gearXp);
    const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
    return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
  },
};
