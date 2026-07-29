// Minigame registry — the modular slot. Each entry is a self-contained React component that receives
// an `input` data structure and calls `onComplete(result)` with an output data structure when done.
// The harness (MinigameScreen) looks a minigame up by id, renders it, and routes its result to the
// server (meta endpoint) for reward resolution. Register a new minigame by dropping it in this map.
import TestButtonGame from './TestButtonGame.jsx';

export const MINIGAMES = {
  'test-button': TestButtonGame,
};
