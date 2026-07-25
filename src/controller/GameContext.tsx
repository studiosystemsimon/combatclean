// === GameProvider — reducer + owned timers + status resolvers + persistence + actions ===
// Ported near-verbatim from MergeCombat controller/GameContext.jsx. State + dispatch via useReducer;
// the seeded sim rng (seedSim) + content C are set at boot. Persistence routes through the six-section
// account (src/game/store/persistence). The view reads {state, actions} via useGame() — its seam.
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { reducer, initState } from '../game/store/reducer.ts';
import { A } from '../game/store/actions.ts';
import { C } from '../game/content.ts';
import { seedSim } from '../game/sim-random.ts';
import { loadSaved, save, clearSaved } from '../game/store/persistence.ts';

const StateContext = createContext<any>(null);
const ActionsContext = createContext<any>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    seedSim(Date.now());
    try { return initState(Date.now(), loadSaved()); } catch { return initState(Date.now()); }
  });

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: A.REGEN_TICK, now: Date.now() }), C.RUNTIME.regenTickMs);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      dispatch({ type: A.BATTLE_TICK, dt: C.BATTLE.tickMs });
    }, C.BATTLE.tickMs);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const s = state.battle.status;
    if (s === 'clearing') { const id = setTimeout(() => dispatch({ type: A.SHOW_COMPLETE }), C.BATTLE.clearPauseMs); return () => clearTimeout(id); }
    if (s === 'lost') { const id = setTimeout(() => dispatch({ type: A.RESOLVE_LOSS }), C.BATTLE.loseBannerMs); return () => clearTimeout(id); }
    if (s === 'won') { const id = setTimeout(() => dispatch({ type: A.RESOLVE_WIN }), C.BATTLE.completeBannerMs); return () => clearTimeout(id); }
    if (s === 'chest') { const id = setTimeout(() => dispatch({ type: A.RESOLVE_CHEST }), C.BATTLE.chestFallbackMs); return () => clearTimeout(id); }
    if (s === 'intro') { const id = setTimeout(() => dispatch({ type: A.START_COMBAT }), C.BATTLE.introFallbackMs); return () => clearTimeout(id); }
    return undefined;
  }, [state.battle.status]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSaveRef = useRef(0);
  useEffect(() => {
    const t = Date.now();
    if (t - lastSaveRef.current >= C.RUNTIME.persistThrottleMs) { lastSaveRef.current = t; save(state); }
  }, [state]);

  useEffect(() => {
    const flush = () => save(stateRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else dispatch({ type: A.RESUME_AFK, now: Date.now() });
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', flush); };
  }, []);

  const actions = useMemo(() => ({
    setScreen: (screen: string) => dispatch({ type: A.SET_SCREEN, screen }),
    setBattleLevel: (level: number) => dispatch({ type: A.SET_BATTLE_LEVEL, level }),
    collectAfk: () => dispatch({ type: A.COLLECT_AFK }),
    tapGenerator: (index: number) => dispatch({ type: A.TAP_GENERATOR, index, now: Date.now() }),
    moveOrMerge: (from: number, to: number) => dispatch({ type: A.MOVE_OR_MERGE, from, to }),
    fulfillOrder: (orderId: number, orderPt?: any) => dispatch({ type: A.FULFILL_ORDER, orderId, orderPt }),
    fillOrderGap: (orderId: number) => dispatch({ type: A.FILL_ORDER_GAP, orderId }),
    emptyOrder: (orderId: number) => dispatch({ type: A.EMPTY_ORDER, orderId }),
    rerollOrder: (orderId: number) => dispatch({ type: A.REROLL_ORDER, orderId }),
    tapLimit: (heroId: string) => dispatch({ type: A.TAP_LIMIT, heroId }),
    setFocusTarget: (uid: number) => dispatch({ type: A.SET_FOCUS_TARGET, uid }),
    challengeNext: () => dispatch({ type: A.CHALLENGE_NEXT }),
    startCombat: () => dispatch({ type: A.START_COMBAT }),
    pauseChest: () => dispatch({ type: A.PAUSE_CHEST }),
    resolveChest: () => dispatch({ type: A.RESOLVE_CHEST }),
    summon: (bannerId: string, count = 1) => dispatch({ type: A.SUMMON, bannerId, count }),
    ascendHero: (cid: string) => dispatch({ type: A.ASCEND_HERO, id: cid }),
    levelUpHero: (id: string) => dispatch({ type: A.LEVEL_UP_HERO, id }),
    levelUpHeroMax: (id: string) => dispatch({ type: A.LEVEL_UP_HERO_MAX, id }),
    equipItem: (heroId: string, gearId: string) => dispatch({ type: A.EQUIP_ITEM, heroId, gearId }),
    levelAllOne: (id: string) => dispatch({ type: A.LEVEL_ALL_ONE, id }),
    levelAllMax: (id: string) => dispatch({ type: A.LEVEL_ALL_MAX, id }),
    swapHeroes: (a: string, b: string) => dispatch({ type: A.SWAP_HEROES, a, b }),
    autoEquip: () => dispatch({ type: A.AUTO_EQUIP }),
    autoLevel: () => dispatch({ type: A.AUTO_LEVEL }),
    autoHero: (id: string) => dispatch({ type: A.AUTO_HERO, id }),
    levelGear: (id: string) => dispatch({ type: A.LEVEL_GEAR, id }),
    fuseGear: (id: string) => dispatch({ type: A.FUSE_GEAR, id }),
    equipBest: (id: string) => dispatch({ type: A.EQUIP_BEST, id }),
    upgradeHero: (id: string) => dispatch({ type: A.UPGRADE_HERO, id }),
    clearFx: (ids: number[]) => dispatch({ type: A.CLEAR_FX, ids }),
    resetGame: () => { clearSaved(); dispatch({ type: A.RESET_GAME, now: Date.now() }); },
  }), []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export const useGame = () => {
  const state = useContext(StateContext);
  const actions = useContext(ActionsContext);
  if (state == null || actions == null) throw new Error('useGame must be used within <GameProvider>');
  return { state, actions };
};
export const useActions = () => {
  const actions = useContext(ActionsContext);
  if (actions == null) throw new Error('useActions must be used within <GameProvider>');
  return actions;
};
