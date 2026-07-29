# minigame — the minigame harness (the contract / "treaty")

The agreement between a **minigame**, the **harness** that runs it, and the **server** that pays it out.
A minigame is a self-contained, modular, full-screen mini-experience: it is handed an INPUT data
structure and returns a RESULT data structure — nothing more. The result is submitted to a
server-authoritative endpoint that resolves a reward, which is revealed + granted in a reward popup.
The engine runs HEADLESS underneath the whole time (see `src/controller/README.md`), so leaving a
minigame returns you to the exact, still-advancing gameplay.

## The contract — data in → data out

A minigame is a React component registered in `src/view/minigame/registry.js`:

```
MINIGAMES[id] = ({ input, onComplete }) => JSX
```

- `input` — the data structure the harness passes in (from `actions.startMinigame(id, input)`).
- `onComplete(result)` — call ONCE when the minigame finishes, with its output data structure.
  `result.score` (a number) drives the reward; a minigame may carry extra fields the server reads.

That is the *entire* surface a minigame must implement. It never touches combat, the account, or
rewards — the harness owns everything before `input` and after `onComplete`.

## Data structures (`src/game/minigame/meta.ts`)

| Type | Shape | Produced by |
|---|---|---|
| input | anything (per minigame) | the trigger — `startMinigame(id, input)` |
| `MinigameResult` | `{ score?, …extra }` | the minigame — `onComplete(result)` |
| `MinigameSubmission` | `{ minigameId, result }` | the harness |
| `MinigameReward` | `{ coins, heroXp, gearXp }` | the server |
| `MinigameOutcome` | `{ minigameId, reward }` | the server |

## Lifecycle

1. **Launch** — `actions.startMinigame(id, input)` → `state.minigame = { id, input }`.
2. **Full screen + headless** — `isFullScreen` is now true → the combat panel + FxLayer unmount and the
   engine keeps ticking headless. `MinigameScreen` (the host) renders `MINIGAMES[id]` with
   `{ input, onComplete }`.
3. **Play → result** — the minigame calls `onComplete(result)`.
4. **Server call** — the host calls `actions.submitMinigame(id, result)`; the controller `await`s the
   meta endpoint `submitMinigame({ minigameId, result })`, which returns a `MinigameOutcome`.
5. **Resolve** — `FINISH_MINIGAME` clears the minigame (back to the underlying combat screen, engine
   resumes seamlessly) and opens the reward popup with the resolved reward.
6. **Claim** — the reward popup's *Collect* → `CLOSE_REWARD` grants the reward into the wallet
   (`coins`/`heroXp`/`gearXp`) and dismisses. (`exitMinigame` bails out early with no reward.)

## The server seam

`submitMinigame` in `meta.ts` IS the server. Today it resolves **in-process** from config
(`C.MINIGAME`: `reward` base `+ perScore × result.score`). It is server-AUTHORITATIVE by contract —
the client submits only the result; the server decides the reward. Porting to a real backend is a
WIRING CHANGE: replace the body with a `@bishop/meta-client` round-trip that returns the SAME
`MinigameOutcome`; the controller and view are unchanged.

## Reward rules (config — "all tuning is data")

`src/data/config/game/_minigame.json` (schema `zMinigameConfig` in `schemas/singletons.ts`, read as
`C.MINIGAME`): `reward` (flat, per completion) + `perScore` (per point of `result.score`). All amounts
are exposed data — never hardcoded in the endpoint.

## Adding a minigame

1. Write the component `({ input, onComplete }) => …`; call `onComplete({ score })` when it ends.
2. Register it — `MINIGAMES['my-game'] = MyGame` in `src/view/minigame/registry.js`.
3. Launch it — `actions.startMinigame('my-game', input)` from any trigger (a node, shop, daily, …).
   The reward round-trip + popup are automatic; tune the payout in `_minigame.json`.

## Invariants

- A minigame implements ONLY `{ input, onComplete }` — no combat / account / reward access.
- `onComplete` fires ONCE; the harness owns the result → server → reward → grant flow.
- Rewards are SERVER-AUTHORITATIVE (resolved by the meta endpoint), CONFIG-DRIVEN, and granted on
  CLAIM (`CLOSE_REWARD`) — never by the minigame itself.
- The engine runs headless for the minigame's whole life (never paused); returning is seamless.
- Routes through EXISTING systems only — the full-screen/headless model, the six-section resource
  wallet, and the popup pattern. No parallel reward or economy path.
