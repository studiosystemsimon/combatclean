// === reducer slice: shell — screen/menu/AFK/minigame/reward + plumbing (regen, reset, clear-fx) ===
// UI-shell + meta state transitions. Bodies moved verbatim from the former monolithic reducer switch.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Energy from '../energy/energy.ts';
import * as Map from '../map/map.ts';
import { C } from '../content.ts';
import { A } from './actions.ts';
import { sumAfk, initState } from './reducer-helpers.ts';

type S = any;
type Act = any;

export const shellHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.SET_SCREEN]: (state, action) =>
    // Changing the active screen (e.g. a nav-bar tap) also closes any open hero menu sub-view.
    ({ ...state, screen: action.screen, menuHeroId: null }),
  [A.SET_HERO_MENU]: (state, action) =>
    // Opening clears the fx queue so no stale combat VFX flashes when FxLayer remounts on close.
    ({ ...state, menuHeroId: action.heroId, fx: action.heroId ? [] : state.fx }),
  [A.SET_AFK_OPEN]: (state, action) =>
    // Full-screen AFK collection popup (combat paused underneath). Clear fx on open like the hero menu.
    ({ ...state, afkOpen: action.open, fx: action.open ? [] : state.fx }),
  [A.SET_HEADLESS]: (state, action) =>
    // Background mode: the view unmounts but the engine keeps ticking. Clear fx (nothing renders them).
    ({ ...state, headless: action.on, fx: action.on ? [] : state.fx }),
  [A.SET_MINIGAME]: (state, action) =>
    // A minigame is a full screen that replaces the current one; combat runs headless underneath.
    ({ ...state, minigame: action.minigame ?? null, fx: action.minigame ? [] : state.fx }),
  [A.FINISH_MINIGAME]: (state, action) =>
    // The (server-resolved) reward comes back → leave the minigame and reveal it in the reward popup.
    // Amounts were computed server-side (meta endpoint); the grant happens on claim (CLOSE_REWARD).
    ({ ...state, minigame: null, fx: [], rewardPopup: { reward: action.reward || { coins: 0, heroXp: 0, gearXp: 0 }, source: action.source || 'minigame' } }),
  [A.CLOSE_REWARD]: (state) => {
    // Claim: grant the shown reward into the wallet, then dismiss.
    const r = (state.rewardPopup && state.rewardPopup.reward) || { coins: 0, heroXp: 0, gearXp: 0 };
    return { ...state, coins: state.coins + (r.coins || 0), heroXp: state.heroXp + (r.heroXp || 0), gearXp: state.gearXp + (r.gearXp || 0), rewardPopup: null };
  },
  [A.COLLECT_AFK]: (state) => {
    const a = state.pendingAfk; if (!a) return state;
    // Claiming grants the idle rewards, clears pendingAfk (→ the AFK! tile disappears) and closes the popup.
    return { ...state, coins: state.coins + a.coins, heroXp: state.heroXp + a.heroXp, gearXp: state.gearXp + a.gearXp, pendingAfk: null, afkOpen: false };
  },
  [A.RESUME_AFK]: (state, action) => {
    const elapsed = action.now - state.now;
    if (elapsed < C.AFK.minReportMs) return { ...state, now: action.now };
    const add = Map.afkEarnings(state.clearedLevel, elapsed);
    if (!(add.coins || add.heroXp || add.gearXp)) return { ...state, now: action.now };
    const pendingAfk = state.pendingAfk ? sumAfk(state.pendingAfk, add) : add;
    return { ...state, pendingAfk, now: action.now };
  },
  [A.SET_FLAG]: (state, action) =>
    // Set a persisted feature/FTUE flag (e.g. the FTUE flips `specialOrders` on to unlock special orders).
    ({ ...state, flags: { ...state.flags, [action.flag]: action.value } }),
  [A.REGEN_TICK]: (state, action) =>
    ({ ...state, energy: Energy.regen(state.energy, action.now), now: action.now }),
  [A.RESET_GAME]: (_state, action) => initState(action.now),
  [A.CLEAR_FX]: (state, action) =>
    ({ ...state, fx: state.fx.filter((e: any) => !action.ids.includes(e.id)) }),
};
