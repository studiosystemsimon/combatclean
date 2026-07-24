# @bishop/render-contract

The **renderer interface** every game-view implements, plus the camera/focus math around it.
Engine scope (`@bishop/*`): **zero game dependency by design** — the game's world-state is the generic
`TState`, treated as opaque here. This is the seam between the game-client (drives the loop) and a
concrete renderer (2D canvas, PixiJS, 3D/Babylon).

## What it defines

- **`IGameView<TState>`** — `init / render / resize / destroy` + optional `setVolume`, `setViewFocus`,
  `getViewTransform`. A renderer binds a concrete state type; the engine only knows the drive protocol.
- **`ViewFocus`** — the LOGICAL region to keep in view (world-space `center` + `worldExtent`),
  projection-agnostic. The client decides it (follow/clamp/zoom); the renderer turns it into its own
  camera (2D fit / 3D ortho / 3D perspective). "Camera" the concrete object stays renderer-internal.
- **`ViewTransform`** — the screen↔world transform (`offset` + `scale`) a renderer can expose for
  picking + area-of-interest.
- **Pure math**: `viewFocusRect(focus)` and `worldRectFromTransform(vt, w, h)` — the world rect a focus
  frames / a transform maps a viewport onto. Culling + screen→world picking derive from these; there is
  no separate "interest rect" primitive.

## Extending — add to the contract, don't fork per renderer

- New capability every renderer *may* expose → an **optional** method on `IGameView` (like
  `setViewFocus?`). Optional keeps existing renderers valid; a renderer that skips it just keeps its own
  behaviour.
- New shared framing concept → a data type + pure function here (as `ViewFocus`/`viewFocusRect` did),
  so both the client and every renderer speak it identically.

## When NOT to extend

- **Never add a game concept** (entities, factions, abilities, HUD…). Those ride inside the opaque
  `TState` — this package must not name them.
- **Renderer-specific knobs** (FOV, eye height, ortho size, sprite atlas) belong in that renderer's own
  config, not the shared contract. The contract carries only what the client→renderer seam needs.
- Don't add a method a single renderer needs — that's renderer-internal, not a contract.

## Shape

Compiles to `dist/` (pure TS, no JSX). Single entry `.` re-exports the interface, the types, and the two
math helpers.
