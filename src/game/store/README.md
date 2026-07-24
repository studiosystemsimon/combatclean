# store — the sim reducer + persistence

`actions.ts` (the action-type map), `reducer.ts` (the single sim tree ported from MergeCombat — merge,
orders, energy, battle, gacha, gear, heroes), `persistence.ts` (maps the runtime state slice ↔ the
six-section account blob).

**Invariants** — the reducer is pure over `(state, action)`; randomness comes from the module PRNG
(`sim-random.ts`, seeded by the controller), time from action payloads (`now`). Persistence is
lossless: `fromBlob(toBlob(slice))` reproduces the slice `initState` expects (wallets→`resources`,
heroes/gear→`items`, rest→`profile`/`features`). No hidden multipliers — all tuning via `content.ts`.
