// Centralized data store with Vite HMR support. JSON files are deep-cloned into
// mutable exports; Vite dep-accept callbacks patch them IN PLACE on change, so
// the running sim reads new values on the next frame with NO reload. This is the
// backbone of the "all tuning is data" rule — every gameplay number lives in a
// JSON file here and is read via these exports.
//
// TO ADD A NEW DATA FILE (e.g. `movement.json`):
//   1. Create `src/data/movement.json`.
//   2. Add its typed interface to `./types.ts` and to `GameData`.
//   3. `import movementJson from './movement.json';`
//   4. `export const movementConfig = persist('movementConfig', movementJson as MovementConfig);`
//   5. Add it to the `gameData` aggregate below.
//   6. Add a literal `import.meta.hot.accept('./movement.json', ...)` block.
//
// IMPORTANT: import.meta.hot.accept() calls must stay LITERAL — Vite's static
// analyzer only recognises direct calls, never through an alias or a loop.

import type { GameData, GameConfig } from './types';

import gameJson from './game.json';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepReplace(target: any, source: any): void {
  if (Array.isArray(target) && Array.isArray(source)) {
    target.length = source.length;
    for (let i = 0; i < source.length; i++) {
      const sv = source[i];
      if (sv !== null && typeof sv === 'object' && target[i] !== null && typeof target[i] === 'object') {
        deepReplace(target[i], sv);
      } else {
        target[i] = Array.isArray(sv) || (sv !== null && typeof sv === 'object') ? clone(sv) : sv;
      }
    }
    return;
  }
  if (target !== null && typeof target === 'object' && source !== null && typeof source === 'object') {
    for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
    for (const key of Object.keys(source)) {
      const sv = source[key];
      const tv = target[key];
      if (sv !== null && typeof sv === 'object' && tv !== null && typeof tv === 'object'
        && Array.isArray(sv) === Array.isArray(tv)) {
        deepReplace(tv, sv);
      } else {
        target[key] = Array.isArray(sv) || (sv !== null && typeof sv === 'object') ? clone(sv) : sv;
      }
    }
  }
}

// Survive HMR module reloads: keep the live object identity stable across edits
// so consumers holding a reference still see patched values.
function persist<T>(key: string, init: T): T {
  if (!import.meta.hot) return clone(init);
  if (import.meta.hot.data[key] === undefined) import.meta.hot.data[key] = clone(init);
  return import.meta.hot.data[key] as T;
}

export const gameConfig: GameConfig = persist('gameConfig', gameJson as GameConfig);
// export const movementConfig: MovementConfig = persist('movementConfig', movementJson as MovementConfig);
// ...one export per data file.

/** Aggregate handed to the simulation. Holds references to the mutable objects
 *  above, so in-place HMR patches are visible here too. */
export const gameData: GameData = {
  game: gameConfig,
  // movement: movementConfig,
  // ...
};

type Listener = (file: string) => void;
const listeners: Set<Listener> = (() => {
  if (!import.meta.hot) return new Set<Listener>();
  return (import.meta.hot.data.listeners as Set<Listener> | undefined)
    ?? (import.meta.hot.data.listeners = new Set<Listener>());
})();

/** Subscribe to "a data file just hot-reloaded" — e.g. to restart geometry that
 *  can't be patched live. Returns an unsubscribe fn. */
export function onDataReload(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify(file: string): void { for (const l of listeners) l(file); }

if (import.meta.hot) {
  import.meta.hot.accept('./game.json', (m) => { if (m) { deepReplace(gameConfig, m.default); notify('game'); } });
  // import.meta.hot.accept('./movement.json', (m) => { if (m) { deepReplace(movementConfig, m.default); notify('movement'); } });
  // ...one accept block per data file.
}
