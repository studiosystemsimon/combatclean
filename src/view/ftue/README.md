# ftue — the first-time-user-experience coachmark layer (view)

A thin, **detachable guide layer** over gameplay. `FtueLayer.jsx` reads `{state, actions}`, picks the
first unseen beat from `beats.js` whose `show(state)` holds, and renders its coachmark; action beats
auto-advance when `done(state)` is met, info beats on GOT IT. Each beat records a persisted
`ftueSeen_<id>` flag (via `actions.setFlag`) so it fires once. The wrapper is click-through
(`pointer-events:none`) so the player still forges / merges / delivers / taps beneath — only GOT IT
captures input. Inline-styled + self-contained (no CSS-file coupling).

**The FTUE is overrides + flags, not tutorial logic in gameplay.** The sim-side of the layer is a
config singleton (`src/data/config/schemas/ftue.ts` → `C.FTUE`) read through guarded hooks:
- `buildWave` (battle) — zone-1 `zoneEnemyCounts` + pinned `firstEnemies`, when `flags.ftueActive`.
- `initState` (reducer-helpers) — arms `flags.ftueActive` on a fresh save (from `enabledByDefault`);
  forces the opening TWO orders — [0] the Limit Potion (`firstOrder*`) + [1] a good armour piece
  (`secondOrder*`, carried as `forceSlot` on the order); and starts the FTUE run with `specialOrders`
  OFF (the opening roll + gap-fills suppress specials until they unlock later).
- `FULFILL_ORDER` (reducer-orders) — a delivered order carrying `forceSlot` grants a deterministic
  slot+rarity piece via `Gear.rollGearInSlot` (the guided armour reward). Normal orders never set it.
- lose branch of `RESOLVE_COMBAT` (reducer-combat) — arms `flags.ftueFirstLoss` on the FIRST defeat
  (drives the pausing "equip your best gear + level to max" beat). Monotonic.
- `RESOLVE_WIN` (reducer-combat) — arms `flags.ftueFirstPull` when the player reaches `summonAtLevel`
  (level 5 — "things are getting tough, hire a hero") + flips `flags.specialOrders` true on reaching
  `specialsUnlockAtLevel`. Its `TAP_LIMIT` handler records the monotonic coachmark flags
  `ftueLimitFired` (first limit break) + `ftueAlchemistUsed` (the recruited `firstPullHero` firing its
  AOE limit).
- `SUMMON` (reducer-gacha) — the predetermined free pull (`C.FTUE.firstPullHero`); the recruit arrives
  battle-ready (full limit) AND the screen auto-returns to `merge` so the paused Alchemist-explain beat
  fires. Clears `ftueFirstPull`, sets `ftuePulled`.
- battle tick (controller `GameContext`) — honours `flags.ftuePaused`, so any `pause` coachmark beat
  (the Alchemist explain, the first-loss equip lesson, the gear-up nudge) freezes combat while on screen.
  The boss-gate "hire another" beat needs no pause — the gate already holds combat.

**Removal contract** — the whole layer detaches with near-zero gameplay impact:
- **Disable for new players:** `_ftue.json` `enabledByDefault:false` → `initState` never sets
  `flags.ftueActive` → every hook falls through to vanilla gameplay (verified build-green).
- **Delete entirely:** drop `src/view/ftue/` + its one `<FtueLayer/>` mount in `Game.jsx`, remove the
  `ftue` manifest singleton + `_ftue.json`, and delete the guarded hook lines above (each falls through
  to vanilla gameplay when its flag is unset). No other gameplay code references the layer.

**Invariants** — view-only (reads state, dispatches only `setFlag`); no game logic here; beats gate on
observable state so the sequence self-heals across refreshes (seen flags persist on the account).
