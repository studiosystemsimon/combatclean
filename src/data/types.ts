// Typed shapes for every data file under src/data. Each *.json file gets an
// interface here; `GameData` is the aggregate the simulation reads.
//
// JSDoc on a field is the contract for a tunable — a knob a designer adjusts.
// Keep these in sync with the JSON (the `arch-data-values` agent assumes every
// gameplay literal has a home here).

export interface GameConfig {
  /** Logical world width in world units. */
  worldWidth: number;
  /** Logical world height in world units. */
  worldHeight: number;
  /** Fixed simulation step in seconds (e.g. 1/60). */
  fixedStepSec: number;
  // ...add your global tunables.
}

// export interface MovementConfig { ... }

/** The aggregate handed to the simulation. One field per data file. */
export interface GameData {
  game: GameConfig;
  // movement: MovementConfig;
  // ...
}
