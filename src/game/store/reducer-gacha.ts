// === reducer slice: gacha — summon (single / ten-pull) ===
// Body moved verbatim from the former monolithic reducer switch. Orchestrates gacha (pity/pull) +
// heroes (newCharacter) + battle squad rebuild; emits the gachaReveal VFX event on state.fx.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Battle from '../combat/battle.ts';
import * as Gacha from '../gacha/gacha.ts';
import { newCharacter } from '../heroes/heroes.ts';
import { C } from '../content.ts';
import { rng } from '../sim-random.ts';
import { A } from './actions.ts';
import { squadOf, battleStatsFor } from './reducer-helpers.ts';

type S = any;
type Act = any;

export const gachaHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.SUMMON]: (state, action) => {
    const banner = C.BANNERS[action.bannerId];
    if (!banner) return state;
    const ten = C.RUNTIME.tenPullCount;
    const count = action.count === ten ? ten : 1;
    const totalCost = count === ten ? banner.ten : banner.cost;
    if (state.coins < totalCost) return state;
    let id = state.nextId; let cidN = state.nextCid;
    let counters = { ...(state.pity[banner.id] || Gacha.initPity(banner)) };
    let heroes = state.heroes; let order = state.order;
    const results: any[] = [];
    for (let i = 0; i < count; i++) {
      const forced = Gacha.pityForce(banner, counters);
      const res = Gacha.pull(banner, rng, forced);
      counters = Gacha.advancePity(banner, counters, res.rarity);
      const c = `c${cidN++}`;
      heroes = { ...heroes, [c]: newCharacter(c, res.id, res.rarity) };
      order = [...order, c];
      results.push({ id: res.id, rarity: res.rarity, cid: c });
    }
    const squad = squadOf(order);
    const statsFn = battleStatsFor(heroes, state.gear, state.ordersCompleted);
    const byId = Object.fromEntries(state.battle.heroes.map((h: any) => [h.id, h]));
    const battle = { ...state.battle, heroes: squad.map((c: string) => byId[c] || Battle.buildHeroes([c], statsFn)[0]) };
    const pity = { ...state.pity, [banner.id]: counters };
    const fx = [...state.fx, { id: id++, type: 'gachaReveal', bannerId: banner.id, results }];
    return { ...state, coins: state.coins - totalCost, heroes, order, pity, battle, nextId: id, nextCid: cidN, fx, lastPull: results[results.length - 1] };
  },
};
