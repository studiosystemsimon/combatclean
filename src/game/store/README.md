# store — the sim reducer + persistence

`actions.ts` (the action-type map) and `persistence.ts` (maps the runtime state slice ↔ the
six-section account blob).

The reducer (`reducer.ts`) is a thin **combinator**: it merges the per-domain HANDLER MAPS from the
slice files into one dispatch table keyed by `action.type` and routes to the owner (unknown type →
state unchanged). Each action is owned by exactly one slice:

| Slice | Owns |
|---|---|
| `reducer-shell.ts` | screen/menu/AFK/minigame/reward + plumbing (regen, reset, clear-fx) |
| `reducer-board.ts` | merge board (generator tap, move / merge / swap) |
| `reducer-orders.ts` | fulfil / fill-gap / empty / reroll |
| `reducer-combat.ts` | level select, tick, limit break, win/loss/area/chest resolution |
| `reducer-gacha.ts` | summon |
| `reducer-heroes.ts` | swap, ascend, level-up(-max) |
| `reducer-gear.ts` | auto-equip/level, per-hero equip/level, fuse, equip-best, upgrade |

`reducer-helpers.ts` holds the shared orchestration primitives + `initState` / `buildBattle`; the
latter two are re-exported from `reducer.ts` so the module's public surface (`reducer`, `initState`,
`buildBattle`) is unchanged.

**Invariants** — every slice handler is pure over `(state, action)`; randomness comes from the module
PRNG (`sim-random.ts`, seeded by the controller), time from action payloads (`now`). One action.type =
one owning slice (no key collisions across the merged maps). Persistence is lossless:
`fromBlob(toBlob(slice))` reproduces the slice `initState` expects (wallets→`resources`,
heroes/gear→`items`, rest→`profile`/`features`). No hidden multipliers — all tuning via `content.ts`.
