# controller — the React run-loop + facade seam

`GameContext.tsx` holds the reducer state (`useReducer`) and exposes `{ state, actions }` to the view
via `useGame()` / `useActions()`. Ported from MergeCombat's controller.

**Owns** — the timers (REGEN_TICK every 1000ms; BATTLE_TICK every `C.BATTLE.tickMs`, `dt = tickMs`,
skipped while `document.hidden`), the five battle status resolvers (clearing→SHOW_COMPLETE,
lost→RESOLVE_LOSS, won→RESOLVE_WIN, chest→RESOLVE_CHEST, intro→START_COMBAT), throttled autosave, and
the visibilitychange flush / RESUME_AFK. Seeds the sim PRNG (`seedSim`) once at boot.

**Invariants** — the view NEVER dispatches raw reducer actions; it calls the `actions` map only. All
persistence goes through `src/game/store/persistence.ts` (the six-section account), never localStorage
directly. Randomness + time live here (the reducer is otherwise pure over its inputs).
