# ARCHITECTURE — the framework contract

This is the **specification** every game bootstrapped from the framework must follow. It is the
"why" behind the hard rules in `templates/CLAUDE.md` and the thing the `.claude/arch-*` agents
enforce. Read it once; it does not change per game.

The framework is **engine-free**: the simulation is plain TypeScript. The renderer is a thin,
swappable reader on top. This is deliberate — it keeps gameplay testable headless, lets the view be
replaced (Canvas → sprite atlas → 3D) without touching logic, and makes every tunable a JSON edit.

## The layers

```
                 ┌───────────────────────────────────────────────┐
   src/data ───▶ │  JSON tuning  +  store.ts (typed, HMR)         │  designers tune here
   (numbers)     └───────────────────────────────────────────────┘
                                   │ read
                                   ▼
   src/game ───▶ ┌───────────────────────────────────────────────┐
   (logic)       │  World + Systems + Brains + signals (world.bus)│  headless, deterministic
                 └───────────────────────────────────────────────┘
                          │ read state + subscribe        ▲ player intent
                          ▼                               │
   src/view ─▶ ┌──────────────────────┐   src/input ─▶ ┌──────────────────────┐
   (render)    │ Canvas renderer      │   (devices)    │ InputAggregator      │
               │ — read-only          │                │ — touch/kbd/gamepad  │
               └──────────────────────┘                └──────────────────────┘
   src/ui ───▶ ┌──────────────────────┐
   (React)     │ HUD / menus via the  │   reads ONLY through the GameApp facade
               │ GameApp facade       │
               └──────────────────────┘

   src/core  — di / events / math / bootstrap (composition root)
   src/app   — DI tokens, run loop, GameApp facade (the seam UI/view read through)
   src/platform — host abstraction (browser vs Capacitor): haptics, audio, device tier
   src/preview  — dev-only device-frame preview (not part of the sim layers above)
   src/marksman — dev-only markup/feedback overlay + capture endpoint (not part of the sim layers above)
```

### Dependency direction (the one diagram that matters)

`data → game → {view, ui}`. Nothing flows back. `game` never imports `view`/`ui`/`react`/DOM.
`view`/`ui` import from `game` **only via `import type`** (read-only types) + subscribe to signals.
The composition root (`src/core/bootstrap/composition.ts`) is the *only* place allowed to import
concrete classes across module boundaries and `new` them up.

## The eight hard rules (and what each buys you)

1. **Data / logic / view / UI separated** — each layer is independently testable and replaceable.
2. **View is a pure reader (OVERRIDING)** — swap the renderer without risking the simulation; run
   the sim headless in tests and the auto-play harness.
3. **Module-per-folder** — every system is a self-contained folder (`src/game/<system>/`) with a
   `README.md`. Add/remove a module by editing the composition root only.
4. **Dependency injection** — modules never construct each other; the composition root wires
   everything by token. Adding a module is a one-line change.
5. **Events over references** — cross-module comms go through `Signal`s on `world.bus`; a publisher
   never knows its subscribers.
6. **Composition over inheritance** — entities are flat data records; behaviour is stateless Systems
   + per-entity Brains. No controller hierarchy.
7. **Specificity over generalization** — concrete implementations first; generalize once 3+ cases
   prove the shape. Avoids speculative frameworks during prototyping.
8. **All tuning is data** — every gameplay number lives in `src/data/*.json` and is read via
   `store.ts`. Enables live HMR tuning and the changeset/playtest workflow.

## The reusable infrastructure (shipped in `templates/skeleton/`)

Four primitives are genuinely game-agnostic and ship verbatim. Build the rest on top.

### 1. `Signal<T>` — the events backbone (`src/core/events/signal.ts`)

A typed observer. A module declares signals it emits; others subscribe. `owner`-tagged
subscriptions can be torn down in bulk (`unsubscribeByOwner`) when an entity dies.

```ts
const onScored = new Signal<{ team: number; points: number }>();
const off = onScored.subscribe((p) => hud.update(p), this);
onScored.dispatch({ team: 0, points: 1 });
```

Your game defines a `GameSignals` hub in `src/game/signals.ts` holding one `Signal` per cross-module
event, exposed on `world.bus`. Producers `dispatch`; the view/UI `subscribe` (never dispatch game
signals — that's the input path's job).

### 2. `Container` + `token` — dependency injection (`src/core/di/`)

A token-keyed IoC container with no decorators/reflect-metadata. Factories receive the container and
pull their own deps. Three shapes: `registerValue`, `registerSingleton` (the common case),
`registerFactory` (transient).

```ts
// src/app/tokens.ts
export const TOKENS = {
  movement: token<MovementSystem>('MovementSystem'),
  renderer: token<Renderer>('Renderer'),
};

// src/core/bootstrap/composition.ts — the ONLY cross-module construction site
container.registerSingleton(TOKENS.movement, (c) => new MovementSystem(c.resolve(TOKENS.spatial)));
```

### 3. The data store (`src/data/store.ts`)

Deep-clones each JSON file into a mutable export; Vite `import.meta.hot.accept` callbacks patch them
**in place** on edit, so the running sim reads new values next frame with no reload. This is what
makes "all tuning is data" pay off — designers (or the live editor / changeset workflow) tune JSON
and see it instantly.

Rules that keep it working:
- `import.meta.hot.accept('./x.json', …)` calls must be **literal** (Vite's static analyzer can't
  follow aliases or loops).
- Every tunable has a typed field in `src/data/types.ts`.
- Consumers read the exported object (`gameConfig.foo`), never re-import the JSON directly.

### 4. `DevicePreviewFrame` — dev-only device-frame preview (`src/preview/`)

A React component (ported in as source, not a package dependency) that wraps the running page in
an iframe-based phone/tablet bezel with a device picker and safe-area overlay, so you can eyeball
real device dimensions from a desktop browser. Mounted from `src/main.ts` behind an
`import.meta.env.DEV` guard — it never reaches a production build. Unlike the other three
primitives it isn't part of the simulation's dependency chain (`data → game → {view, ui}`); it's
pure dev tooling, exempt from the DI/signals/data-values rules, and — being copied-in source rather
than a package — is meant to be edited directly once generated. See `src/preview/README.md`.

### 5. `Marksman` — dev-only markup / feedback overlay (`src/marksman/`)

A React overlay (also vendored in as source, not a package) that floats over the running game so you
can give visual feedback in place: pause, draw a circle + comment / arrow / label on any element, hit
Send, and it writes a **raw capture** (markdown note + screenshot + an *identity bundle* resolving
each mark to a DOM `file:line` or a canvas `entityType`/`configPath`) into the capture inbox
(`.cache/markdown/`). It makes **no** LLM calls — buttons write files; turning a capture into a code
change is the separate `transcript-to-changeset` → `run-changeset` pipeline. Two parts: the client
overlay (mounted from `src/main.ts` behind an `import.meta.env.DEV` guard) and a dev-server endpoint
(a Vite plugin, `apply: 'serve'`, in `vite.config.ts`) that does the file writes — both dev-only,
never in a production build. Like the preview it sits outside the sim dependency chain, is exempt from
the DI/signals/data-values rules, and is meant to be edited directly. The one game-specific seam is
the `GameAdapter` (only `setPaused` required). An optional audio feature adds local whisper.cpp voice
transcription (off by default). See `src/marksman/README.md`.

## What you build per game (the framework specifies the shape)

| Layer | You author | Contract |
|---|---|---|
| `src/game` | `types.ts` (World/System/Brain), `signals.ts` (the hub), systems, brains, entity helpers | Headless; no DOM/render; all numbers from the store. |
| `src/core/bootstrap/composition.ts` | wire every module by token | Only cross-module construction site. |
| `src/app` | `tokens.ts`, the fixed-step run loop, the `GameApp` facade | The facade is the single seam view/UI read through. |
| `src/view` | Canvas renderer, camera, layers | Read-only: reads world state + subscribes to signals; `import type` only. |
| `src/ui` | React `App`, screens, components | Reads via the `GameApp` facade; Tailwind for static style, inline `style` for data-driven. |
| `src/input` | `InputAggregator` (touch/keyboard/gamepad) + a null input | Produces intent the sim consumes; no game logic. |
| `src/platform` | host abstraction | Haptics/audio/device-tier behind ports; browser + Capacitor impls. |

## The run loop

A fixed-step accumulator drives the simulation at a constant rate (e.g. 60 Hz) for determinism;
rendering happens once per `requestAnimationFrame`. Keep simulation out of the RAF callback (only
render there) and never use `setInterval`/`setTimeout` for sim timing — both drift. The `web-perf`
agent checks this.

## Testing posture

Because `src/game` is headless, an auto-play harness in `src/testing` can drive the **real input
path** (no rendering) to smoke-test a full session. Expose it on a dev-only global (e.g.
`window.gameBot`) under an `import.meta.env.DEV` guard so the on-device `android-perf` harness and
your own playtests can script a run.

## Where the governance lives

`.claude/` holds the enforcement: `arch-*` reviewers + `arch-fix-*` fixers (run via the
`arch-review` / `arch-fix` workflows), the `web-perf` / `android-perf` / `icon-gen` specialists, and
the `transcript-to-changeset` / `run-changeset` / `playtest` skills. See `.claude/README.md`.
