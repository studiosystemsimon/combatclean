// ─────────────────────────────────────────────────────────────────────────────
// Vite plugin: provides `virtual:game-config` — the merged logical config as one JSON object.
//
// Agnostic: the engine knows no categories. The project WRAPPER supplies the `manifest` and the
// `gameDir`, plus an optional `compose(merged)` hook to fold in game-specific EXTRAS the engine
// doesn't own (the `_global.json` singletons, string-id catalogs like crossroads-events, and the
// derived `nextIds` map). The plugin scans, validates (schema + refs + ids), composes, and emits.
// ─────────────────────────────────────────────────────────────────────────────
import { assertValidMerged } from "./validate.js";
import type { Manifest } from "./manifest.js";

const VIRTUAL_MODULE_ID = "virtual:game-config";
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`;

export interface GameConfigPluginOptions {
	/** Absolute path to the config/game directory (per-entity JSON folders). */
	gameDir: string;
	/** The game's content-format manifest. */
	manifest: Manifest;
	/** Fold in game-specific extras (singletons, derived nextIds, string-id catalogs). Receives the
	 *  validated category data; returns the object serialized to `virtual:game-config`. */
	compose?: (merged: Record<string, unknown>, gameDir: string) => Record<string, unknown>;
	/** Fail the build on any schema/ref/id validation error. Default true. */
	validate?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: Vite's Plugin type is not a dep of this package.
export function gameConfigPlugin(options: GameConfigPluginOptions): any {
	const { gameDir, manifest, compose, validate = true } = options;

	return {
		name: "bishop-config-registry",

		resolveId(id: string) {
			if (id === VIRTUAL_MODULE_ID) return RESOLVED_ID;
		},

		async load(id: string) {
			if (id !== RESOLVED_ID) return;
			// Import node-only bits lazily so the plugin module stays importable in non-node contexts.
			const { scanConfigDir } = await import("./node.js");
			const merged = scanConfigDir(gameDir, manifest);
			if (validate) assertValidMerged(merged, manifest);
			const full = compose ? compose(merged, gameDir) : merged;
			return `export default ${JSON.stringify(full)}`;
		},

		// biome-ignore lint/suspicious/noExplicitAny: Vite ViteDevServer not typed here.
		configureServer(server: any) {
			server.watcher.add(gameDir);
			server.watcher.on("change", (path: string) => {
				if (!path.startsWith(gameDir)) return;
				const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
				if (mod) {
					server.moduleGraph.invalidateModule(mod);
					server.ws.send({ type: "full-reload" });
				}
			});
		},
	};
}
