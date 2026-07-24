import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Marksman from "./Marksman";
import type { GameAdapter } from "./types";
import { installOverlayInputKeyGuard } from "./internal/input-guard";

// CORE — the markup overlay + the file-based task pipeline. Voice/audio is an optional feature whose
// dev-server routes ship separately (see ./features/audio/server.mjs, wired in vite.config.ts); it
// needs no export here.
//
// Vendored into this game as in-repo source (not an npm dependency) so it's yours to edit — see
// ./README.md. Dev-only: mounted from src/main.ts behind an `import.meta.env.DEV` guard.

export * from "./types";
export {
	buildBundle,
	buildMarkdown,
	loadConfig,
	loadDoc,
	postTask,
	saveDoc,
	sendTask,
	taskSlug,
} from "./emit";
export type { EmitConfig } from "./emit";

// Skeleton mount shim (dev-only). `main.ts` calls this behind an `import.meta.env.DEV`
// guard, the same way `src/preview` is wired. See ./mount.ts and ./README.md.
export { mountMarksmanOverlay } from "./mount";

/** Mount the Marksman markup overlay onto `target` (usually document.body, above the game).
 *  Dormant until toggled (FAB or backtick). Returns a disposer.
 *
 *  We mount the React root into a dedicated container div appended to `target` rather than into
 *  `target` itself — a React root owns (and will clobber) its container's children, so mounting
 *  straight onto document.body would fight the game's own DOM. */
export function mountMarksman(target: HTMLElement, adapter: GameAdapter): { destroy: () => void } {
	installOverlayInputKeyGuard();
	const host = document.createElement("div");
	host.className = "mk-root";
	target.appendChild(host);
	const root = createRoot(host);
	root.render(createElement(Marksman, { adapter }));
	return {
		destroy: () => {
			root.unmount();
			host.remove();
		},
	};
}
