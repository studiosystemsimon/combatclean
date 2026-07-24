// ─────────────────────────────────────────────────────────────────────────────
// Vite plugin: provides `virtual:asset-registry` exporting { registry, urlById }.
// `registry` = Map<assetId, ResolvedAsset> (POST-processing metadata). `urlById` =
// Record<assetId, Record<authoredFileToken, url>> — resolution is BY assetId; no path
// is ever a lookup key (the authored token is stable across processing).
//
// ONE ship model, driven purely by config: scan → process → bake the RESOLVED
// registry (`ResolvedAsset[]`) directly into the virtual module. Whether any transform
// runs is just data — a build profile with `processing` pipelines transforms; one without
// is a no-op. Because the registry is resolved node-side (extractors + processors already
// ran), the client never re-runs extractors — it just reads the baked entries.
//
// Agnostic: the plugin knows no asset types. pnpm keeps each package's deps private, so the
// project WRAPPER (which depends on the format/processor packages) registers them node-side:
//
//   • `registerFormats`    — imports the format package(s) → extractors + zod schemas.
//   • `registerProcessors` — imports the processor package(s) → registerAssetProcessor (only
//                            needed when the active profile has pipelines).
//
// Example wrapper:
//   assetRegistryPlugin({
//     registerFormats: async () => {
//       await import("@bishop/asset-types-2d");        // extractors
//       await import("@bishop/asset-types-2d/schema"); // zod schemas
//     },
//     registerProcessors: async () => { await import("@bishop/asset-processors"); },
//     profile: process.env.ASSET_PROFILE,
//     processing: { web: [ … ], playable: [ … ] },
//   })
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { scanAssetsDir, validateAssetsDir } from "./node.js";
import { PROCESSED_PREFIX, type ProcessingConfig, processRegistry } from "./processing.js";

const DEFAULT_VIRTUAL_MODULE_ID = "virtual:asset-registry";

export interface AssetRegistryPluginOptions {
	/** Assets root. Defaults to VITE_ASSETS_ROOT env, else `packages/assets` under the monorepo root. */
	assetsRoot?: string;
	/** Virtual module id this instance serves. Default `virtual:asset-registry`. Set a distinct id
	 *  (e.g. `virtual:asset-registry-3d`) to run a SECOND instance over another root in the same build. */
	virtualModuleId?: string;
	/** Callback that imports the format package(s) so extractors + schemas register (node-side). */
	registerFormats?: () => void | Promise<void>;
	/** Callback that imports the processor package(s) so `registerAssetProcessor` runs (node-side). */
	registerProcessors?: () => void | Promise<void>;
	/** Fail the build on validation errors when a schema is registered. Default true. */
	validate?: boolean;
	/** Active build profile — selects which `processing` pipelines run. Default `ASSET_PROFILE` env. */
	profile?: string;
	/** Per-profile asset-processing pipelines. A profile with pipelines transforms its assets;
	 *  a profile without (or no config) is a no-op — the registry is baked as scanned. */
	processing?: ProcessingConfig;
	/** REACHABILITY TRIM (dependency-driven pack). When set, only assets whose id is in
	 *  `ids` OR starts with one of `prefixes` are baked/emitted — the rest are excluded from
	 *  THIS build's bundle (their source art is NEVER deleted; the on-disk registry stays a
	 *  full superset for web/editor). Omit for a full build. The keep spec is registry-
	 *  INDEPENDENT (config ∪ CSS ∪ code refs) and expanded against the freshly-scanned
	 *  registry here, so a stale generated file can't drop a live asset. */
	keep?: { ids?: Iterable<string>; prefixes?: Iterable<string> };
}

function findMonorepoRoot(startDir: string): string {
	let dir = startDir;
	while (dir && !existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
		const parent = resolve(dir, "..");
		if (parent === dir) return startDir;
		dir = parent;
	}
	return dir;
}

// biome-ignore lint/suspicious/noExplicitAny: Vite's Plugin type is not a dep of this package.
export function assetRegistryPlugin(options: AssetRegistryPluginOptions = {}): any {
	const { registerFormats, registerProcessors, validate = true } = options;
	const virtualModuleId = options.virtualModuleId ?? DEFAULT_VIRTUAL_MODULE_ID;
	const resolvedId = `\0${virtualModuleId}`;
	const profile = options.profile ?? process.env.ASSET_PROFILE ?? "";
	const hasPipelines = !!(profile && options.processing?.[profile]?.length);
	let assetsRoot: string;
	let cacheDir: string;
	let registered = false;

	async function ensureRegistered(): Promise<void> {
		if (registered) return;
		await registerFormats?.();
		if (hasPipelines) await registerProcessors?.();
		registered = true;
	}

	return {
		name: `bishop-asset-registry${virtualModuleId === DEFAULT_VIRTUAL_MODULE_ID ? "" : `:${virtualModuleId}`}`,

		// biome-ignore lint/suspicious/noExplicitAny: Vite ResolvedConfig not typed here.
		configResolved(config: any) {
			const monorepoRoot = findMonorepoRoot(config.root);
			const envRoot = config.env?.VITE_ASSETS_ROOT || process.env.VITE_ASSETS_ROOT;
			if (envRoot) assetsRoot = resolve(config.root, envRoot);
			else if (options.assetsRoot) assetsRoot = resolve(config.root, options.assetsRoot);
			else assetsRoot = resolve(monorepoRoot, "packages/assets");
			cacheDir = resolve(monorepoRoot, "node_modules/.cache/asset-processing");
		},

		resolveId(id: string) {
			if (id === virtualModuleId) return resolvedId;
		},

		async load(id: string) {
			if (id !== resolvedId) return;
			await ensureRegistered();

			if (validate && registerFormats) {
				const errors = validateAssetsDir(assetsRoot);
				if (errors.length > 0) {
					const lines = errors
						.slice(0, 50)
						.map((e) => `  ${e.file ?? "?"} · ${e.assetId ?? ""} — ${e.message}`);
					throw new Error(
						`[asset-registry] ${errors.length} validation error(s):\n${lines.join("\n")}`,
					);
				}
			}

			// Scan (extractors + alias pointers applied) → process (no-op without pipelines) → bake the
			// resolved registry. Emitted (`@proc/…`) files live in the processing cache dir; source files
			// are relative to the assets root.
			const { registry } = scanAssetsDir(assetsRoot);

			// REACHABILITY TRIM — drop assets not in the keep spec BEFORE processing/emit, so
			// only reachable art is webp-processed + bundled. Source files untouched on disk.
			if (options.keep) {
				const keepIds = new Set(options.keep.ids ?? []);
				const keepPrefixes = [...(options.keep.prefixes ?? [])];
				const before = registry.size;
				for (const id of [...registry.keys()]) {
					const kept = keepIds.has(id) || keepPrefixes.some((p) => id.startsWith(p));
					if (!kept) registry.delete(id);
				}
				// eslint-disable-next-line no-console
				console.log(
					`[asset-registry] reachability trim: kept ${registry.size} / ${before} assets ` +
						`(dropped ${before - registry.size} unreferenced from this build's bundle)`,
				);
			}

			// Snapshot each asset's SOURCE files BEFORE processing mutates entry.files to
			// processed (`@proc/…`) paths. Zipping source[j] ↔ processed[j] per asset lets us
			// key the emitted urls by the AUTHORED file token (see below), which is what the
			// runtime resolver references — independent of whatever processing renamed the file to.
			const srcFilesById = new Map<string, string[]>();
			for (const [id, a] of registry) srcFilesById.set(id, [...a.files]);

			await processRegistry(registry, {
				root: assetsRoot,
				profile,
				config: options.processing ?? {},
				cacheDir,
			});

			const resolved = [...registry.values()];
			// Import each unique (processed) file once → an import var.
			const imports: string[] = [];
			const varForRelPath = new Map<string, string>();
			const files = [...new Set(resolved.flatMap((a) => a.files))];
			files.forEach((relPath, i) => {
				const absPath = relPath.startsWith(PROCESSED_PREFIX)
					? join(cacheDir, "blobs", relPath.slice(PROCESSED_PREFIX.length))
					: resolve(assetsRoot, relPath);
				if (!existsSync(absPath)) return;
				const varName = `__u${i}`;
				imports.push(`import ${varName} from ${JSON.stringify(`${absPath}?url`)};`);
				varForRelPath.set(relPath, varName);
			});

			// Emit `urlById[assetId][authoredToken] = url`. The runtime resolves BY assetId; the
			// sub-key is the AUTHORED file token (the asset's source relpath minus its basePath —
			// exactly the `clip.file`/`decl.file`/`files[0]` token the resolver references). The
			// token is authored, so it is STABLE across processing (processing changes the emitted
			// artifact's bytes/extension, never the declared token). No path ever becomes a lookup
			// key, so a source-vs-processed key mismatch is structurally impossible.
			const tokenOf = (relPath: string, basePath: string) =>
				relPath.startsWith(basePath) ? relPath.slice(basePath.length) : relPath;
			const byIdEntries: string[] = [];
			for (const a of resolved) {
				const src = srcFilesById.get(a.id) ?? a.files;
				const sub: string[] = [];
				a.files.forEach((procRel, j) => {
					const varName = varForRelPath.get(procRel);
					if (!varName) return;
					const srcRel = src[j] ?? procRel;
					sub.push(`${JSON.stringify(tokenOf(srcRel, a.basePath))}: ${varName}`);
				});
				if (sub.length) byIdEntries.push(`  ${JSON.stringify(a.id)}: { ${sub.join(", ")} }`);
			}

			return [
				...imports,
				"",
				`const __resolved = ${JSON.stringify(resolved)};`,
				"export const registry = new Map(__resolved.map((a) => [a.id, a]));",
				"",
				"export const urlById = {",
				byIdEntries.join(",\n"),
				"};",
			].join("\n");
		},
	};
}
