# game — the headless sim's contract layer (types · signals · content · rng)

The shared contracts every `src/game/<system>` module reads. Flat, composition-over-inheritance,
headless — no DOM/render types here.

- `types.ts` — the sim's data records (World / System / Brain, board / orders / hero / gear / etc.).
  Run state lives in the World; persistent state lives in the account (`src/account`).
- `signals.ts` — `createGameSignals()`: the `GameSignals` hub exposed on `world.bus`, one typed
  Signal per cross-module event (replaces MergeCombat's `state.fx` queue).
- `content.ts` — `C`, the sim's read-model over the baked `virtual:game-config` bundle (slug-keyed
  maps + tuning singletons + slug↔numeric-id maps for the account boundary).
- `boot-content.ts` — app-only synchronous init of `C` at module load.
- `rng.ts` / `sim-random.ts` — the seeded PRNG (`makeRng` = mulberry32) and the one `rng` the
  orchestration owns (`seedSim(seed)`).

**Signals** — ↑ defines the hub the whole game dispatches on / the view + FX consume.

**Invariants**
- `C` is **injected** (`createContent(bundle)`), never a hardcoded import — so a Node harness can
  build a bundle and drive the sim with zero DOM/Vite. zod never enters here (plain bundle reads).
- `boot-content.ts` is **app-only** (it statically imports the virtual module). The headless graph
  calls `initContent(scannedBundle)` instead — never import `boot-content` into a sim/system module.
- The rng is **seeded** for determinism (the auto-play harness + the determinism gate rely on it);
  `sim-random.ts` defaults to `Math.random` until `seedSim` runs so nothing crashes pre-boot.
- The view/UI **subscribe** to signals; they never dispatch (that's the input path's job).
