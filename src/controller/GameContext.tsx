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
import { submitMinigame as metaSubmitMinigame } from '../game/minigame/meta.ts';

const StateContext = createContext<any>(null);
const ActionsContext = createContext<any>(null);

// A "full screen" takes over the play area (combat panel + FxLayer hidden) and runs the engine HEADLESS
// — the sim keeps ticking, so returning to a combat screen resumes the exact, still-advancing gameplay.
// (The AFK collect popup is deliberately NOT one — it freezes the sim while you claim offline rewards.)
const FULL_SCREENS = ['map', 'gacha'];
export const isFullScreen = (s: any): boolean => !!s.menuHeroId || !!s.minigame || FULL_SCREENS.includes(s.screen);
// Engine runs headless during any full screen, or the manual background toggle.
export const engineHeadless = (s: any): boolean => !!s.headless || isFullScreen(s);
// The fx overlay (FxLayer) hosts BOTH combat VFX and cross-screen REVEALS (gacha pull, chest, currency),
// so it must stay mounted on combat screens AND the map/gacha full screens — only the hero menu,
// minigame, AFK popup, and manual background hide it. When it's absent, fx are drained here instead.
export const fxVisible = (s: any): boolean => !s.headless && !s.menuHeroId && !s.afkOpen && !s.minigame;

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    seedSim(Date.now());
    try { return initState(Date.now(), loadSaved()); } catch { return initState(Date.now()); }
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const id = setInterval(() => { if (stateRef.current.afkOpen) return; dispatch({ type: A.REGEN_TICK, now: Date.now() }); }, C.RUNTIME.regenTickMs);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s.afkOpen) return; // the AFK collect popup is the one surface that freezes the sim
      if (s.flags && s.flags.ftuePaused) return; // FTUE: a pausing coachmark beat freezes combat while it explains
      // Full screens / background mode keep ticking regardless of tab visibility (seamless resume).
      if (engineHeadless(s)) { dispatch({ type: A.BATTLE_TICK, dt: C.BATTLE.tickMs }); return; }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      dispatch({ type: A.BATTLE_TICK, dt: C.BATTLE.tickMs });
    }, C.BATTLE.tickMs);
    return () => clearInterval(id);
  }, []);

  // Whenever the combat view is unmounted (full screen / background), nothing drains the fx queue — the
  // auto-battle would pile up combat-fx events unbounded. Clear them as they arrive (view-only, safe to drop).
  useEffect(() => {
    if (!fxVisible(state) && state.fx.length) dispatch({ type: A.CLEAR_FX, ids: state.fx.map((f: any) => f.id) });
  }, [state.fx, state.headless, state.menuHeroId, state.afkOpen, state.minigame]);

  useEffect(() => {
    const s = state.battle.status;
    if (s === 'clearing') { const id = setTimeout(() => dispatch({ type: A.SHOW_COMPLETE }), C.BATTLE.clearPauseMs); return () => clearTimeout(id); }
    if (s === 'lost') { const id = setTimeout(() => dispatch({ type: A.RESOLVE_LOSS }), C.BATTLE.loseBannerMs); return () => clearTimeout(id); }
    if (s === 'won') { const id = setTimeout(() => dispatch({ type: A.RESOLVE_WIN }), C.BATTLE.completeBannerMs); return () => clearTimeout(id); }
    if (s === 'chest') { const id = setTimeout(() => dispatch({ type: A.RESOLVE_CHEST }), C.BATTLE.chestFallbackMs); return () => clearTimeout(id); }
    if (s === 'intro') { const id = setTimeout(() => dispatch({ type: A.START_COMBAT }), C.BATTLE.introFallbackMs); return () => clearTimeout(id); }
    return undefined;
  }, [state.battle.status]);

  // AREA COMPLETE with a BOARD AWARD (a generator unlock): route to the merge tab so the generator can
  // dramatically fly onto the board (the combat panel keeps showing the earnings synopsis on top). No
  // route/cinematic for a plain clear. The generatorUnlock cinematic (FxLayer) waits for the board to mount.
  useEffect(() => {
    if (state.battle.status === 'areaComplete' && state.pendingArea && state.pendingArea.unlocked && state.pendingArea.unlocked.length && state.screen !== 'merge') {
      dispatch({ type: A.SET_SCREEN, screen: 'merge' });
    }
  }, [state.battle.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist (throttled) with a guaranteed TRAILING save + an unmount flush, so the LATEST state is never
  // dropped. The old leading-edge-only throttle lost the last <persistThrottleMs of updates (e.g. a hero
  // level-up) when a reload / Vite-HMR remount landed before the next state change triggered a save.
  const lastSaveRef = useRef(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const due = C.RUNTIME.persistThrottleMs - (Date.now() - lastSaveRef.current);
    if (due <= 0) { lastSaveRef.current = Date.now(); save(state); }
    else { // within the throttle window — schedule a trailing save of the LATEST state (stateRef)
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(() => { lastSaveRef.current = Date.now(); trailingRef.current = null; save(stateRef.current); }, due);
    }
  }, [state]);
  // Flush the latest state on teardown (HMR remount / unmount) — pagehide does NOT fire on an HMR swap.
  useEffect(() => () => { if (trailingRef.current) clearTimeout(trailingRef.current); save(stateRef.current); }, []);

  useEffect(() => {
    const flush = () => save(stateRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else if (!engineHeadless(stateRef.current)) dispatch({ type: A.RESUME_AFK, now: Date.now() }); // engine kept running headless — no offline catch-up
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', flush); };
  }, []);

  const actions = useMemo(() => ({
    setScreen: (screen: string) => dispatch({ type: A.SET_SCREEN, screen }),
    setHeroMenu: (heroId: string | null) => dispatch({ type: A.SET_HERO_MENU, heroId }),
    setAfkOpen: (open: boolean) => dispatch({ type: A.SET_AFK_OPEN, open }),
    setHeadless: (on: boolean) => dispatch({ type: A.SET_HEADLESS, on }),
    startMinigame: (id: string, input: unknown = null) => dispatch({ type: A.SET_MINIGAME, minigame: { id, input } }),
    exitMinigame: () => dispatch({ type: A.SET_MINIGAME, minigame: null }),
    // A finished minigame submits its result to the (simulated) server, which resolves the reward; the
    // controller owns this async round-trip and dispatches the outcome (grant + reward popup).
    submitMinigame: async (id: string, result: unknown) => {
      const outcome = await metaSubmitMinigame({ minigameId: id, result: (result || {}) as any });
      dispatch({ type: A.FINISH_MINIGAME, reward: outcome.reward, source: 'minigame' });
    },
    closeReward: () => dispatch({ type: A.CLOSE_REWARD }),
    // Set a persisted feature/FTUE flag (e.g. the FTUE calls setFlag('specialOrders', true) to unlock special orders).
    setFlag: (flag: string, value = true) => dispatch({ type: A.SET_FLAG, flag, value }),
    setBattleLevel: (level: number) => dispatch({ type: A.SET_BATTLE_LEVEL, level }),
    // Start a zone from its first room: (re)spawn that level on the zone-intro cinematic, then show the
    // merge screen (combat panel on top plays the intro; board below).
    startZone: (level: number) => { dispatch({ type: A.SET_BATTLE_LEVEL, level, intro: true }); dispatch({ type: A.SET_SCREEN, screen: 'merge' }); },
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
    acceptAreaComplete: () => dispatch({ type: A.ACCEPT_AREA_COMPLETE }),
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
