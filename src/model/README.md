# model — view-read barrels over the sim

Thin re-export barrels (`battle.js`, `heroes.js`, `gear.js`, `map.js`, …) that expose the pure
selectors the ported view calls (e.g. `normalChargeFrac`, `zoneForLevel`, `gearPower`, `ascendSelection`).

**Invariants** — single source is `src/game/<system>` (each barrel is `export * from '../game/…'`).
NO logic lives here; adding a selector means adding it to the owning `src/game` system, not here.
