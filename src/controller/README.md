# controller — the React run-loop + facade seam

`GameContext.tsx` holds the reducer state (`useReducer`) and exposes `{ state, actions }` to the view
via `useGame()` / `useActions()`. Ported from MergeCombat's controller.

**Owns** — the timers (REGEN_TICK every 1000ms; BATTLE_TICK every `C.BATTLE.tickMs`, `dt = tickMs`,
skipped while `document.hidden`), the five battle status resolvers (clearing→SHOW_COMPLETE,
lost→RESOLVE_LOSS, won→RESOLVE_WIN, chest→RESOLVE_CHEST, intro→START_COMBAT), throttled autosave, and
the visibilitychange flush / RESUME_AFK. Seeds the sim PRNG (`seedSim`) once at boot.

**Headless engine / full screens** (`isFullScreen` / `engineHeadless` in `GameContext`) — a FULL SCREEN
(hero menu `menuHeroId`, a `minigame`, the `map` or `gacha` screen) or the manual background toggle
(`state.headless` → `HeadlessScreen`) hides the combat panel + `FxLayer` and runs the engine HEADLESS:
the ticks keep firing (IGNORING `document.hidden`), so returning to a combat screen resumes the exact,
still-advancing sim (seamless). While headless the fx queue is drained here (no `FxLayer` to consume it)
and RESUME_AFK is skipped on refocus (the engine already ran — no offline catch-up). The lone exception
is the AFK collect popup (`afkOpen`), which deliberately FREEZES the sim while you claim offline rewards.

**Invariants** — the view NEVER dispatches raw reducer actions; it calls the `actions` map only. All
persistence goes through `src/game/store/persistence.ts` (the six-section account), never localStorage
directly. Randomness + time live here (the reducer is otherwise pure over its inputs).
