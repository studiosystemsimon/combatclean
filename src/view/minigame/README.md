# view/minigame — minigame components + registry

The view half of the minigame harness. `registry.js` maps each minigame `id` → a React component that
implements the contract `({ input, onComplete }) => JSX` and calls `onComplete(result)` when done.
`MinigameScreen` (`src/view/screens/MinigameScreen.jsx`) hosts the active one and routes its result to
the server.

**The full contract — data structures, lifecycle, server seam, how to add a minigame, invariants — is
documented in [`src/game/minigame/README.md`](../../game/minigame/README.md) (the canonical "treaty").**
