# events — `Signal<T>` observer primitive (the events backbone)

A typed observer. A module declares the signals it emits; others `subscribe`. Cross-module
communication flows through Signals so modules stay decoupled — a publisher never knows its
subscribers.

**Invariants**
- `owner`-tagged subscriptions can be torn down in bulk via `unsubscribeByOwner(owner)` (e.g. when an
  entity dies) — always tag listeners you can't otherwise unsubscribe.
- This is the primitive; the game's concrete hub is `src/game/signals.ts` (`GameSignals` on
  `world.bus`). Producers `dispatch`; view/UI `subscribe` — the view never dispatches game signals.
