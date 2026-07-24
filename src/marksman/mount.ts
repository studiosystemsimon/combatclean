import { mountMarksman } from "./index";
import type { GameAdapter } from "./types";

/**
 * Mounts the Marksman markup/feedback overlay over the running game. Dev-only tooling —
 * call this from `main.ts` behind an `import.meta.env.DEV` + `window.self === window.top`
 * guard (see ./README.md). Never meant to run in production builds.
 *
 * `mountMarksman` (in ./index.ts) appends its own container div to `document.body` and
 * owns its own React root — independent of whatever `#ui-root` the game's real UI uses,
 * exactly like `src/preview` does. So there's nothing to lay out here; we just build the
 * one game-specific seam (the GameAdapter) and hand it over.
 *
 * The GameAdapter is the ONLY game-specific surface. Only `setPaused` is required; the
 * capture/hit-test hooks are optional and the overlay degrades gracefully without them:
 *  - `setPaused(paused)` — freeze the sim while the user draws, resume on close. Wire this
 *    to your run loop once you have one (src/app). The placeholder boot in `main.ts` has no
 *    loop to pause, so this stub is a no-op there.
 *  - `captureFrame()` — return a composite screenshot (canvas + DOM HUD) so a "Send" writes
 *    a real screenshot.png. Without it, captures still record the marks + resolved targets.
 *  - `hitTestCanvas(x, y)` — resolve a screen pixel to a canvas entity's identity
 *    (entityType + configPath) so marks on canvas-drawn things pin to a real entity, not
 *    just a DOM node. Without it, only DOM targets resolve.
 * See ./README.md for the full contract.
 */
export function mountMarksmanOverlay(): { destroy: () => void } {
  const adapter: GameAdapter = {
    setPaused(_paused: boolean): void {
      // No-op until you have a run loop to pause. Replace with e.g.
      // `gameApp.setPaused(_paused)` once src/app is wired.
    },
    // captureFrame / hitTestCanvas: implement these in your game for full-fidelity
    // screenshots + canvas-entity identity. See the JSDoc above and ./README.md.
  };
  return mountMarksman(document.body, adapter);
}
