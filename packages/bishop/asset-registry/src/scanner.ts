import { extractAssetFiles } from "./formats.js";
import type { AliasManifest, AssetManifestFile, AssetRegistry, ResolvedAsset } from "./types.js";

export interface BuildOptions {
	/**
	 * Sidecar text reader for extractors that follow indirection (e.g. a Tiled `.tsx`
	 * that references a `.png`). fs-backed at scan time; a baked map at runtime.
	 */
	readText?: (relPath: string) => string | undefined;
}

// ─── Registry building ───

/**
 * Build a registry from already-parsed manifests. For each asset the registered
 * extractor (or the convention walker) computes its bundle-able `files` and any
 * opaque `derived` metadata. Pure and format-agnostic — no `type` switch here.
 */
export function buildRegistryFromManifests(
	manifests: { path: string; data: AssetManifestFile }[],
	opts: BuildOptions = {},
): AssetRegistry {
	const registry: AssetRegistry = new Map();

	for (const { path: rawManifestPath, data } of manifests) {
		// Normalize OS separators to "/" so a backslash manifest path (Windows) still
		// yields a real basePath — `lastIndexOf("/")` is -1 on "Dir\\assets.json",
		// which would otherwise collapse basePath to "" and break URL key matching.
		const manifestPath = rawManifestPath.replace(/\\/g, "/");
		const basePath = manifestPath.substring(0, manifestPath.lastIndexOf("/") + 1);

		for (const [id, declaration] of Object.entries(data.assets)) {
			const existing = registry.get(id);
			if (existing) {
				console.warn(
					`[asset-registry] duplicate asset ID "${id}" in ${manifestPath} (already declared in ${existing.manifestPath})`,
				);
				continue;
			}

			const { files, derived } = extractAssetFiles(declaration, {
				basePath,
				readText: opts.readText,
			});

			const entry: ResolvedAsset = {
				id,
				type: declaration.type,
				declaration,
				basePath,
				manifestPath,
				files,
			};
			if (derived) entry.derived = derived;
			registry.set(id, entry);
		}
	}

	return registry;
}

// ─── Alias resolution ───

export function applyAliases(
	registry: AssetRegistry,
	aliases: AliasManifest,
): { applied: number; warnings: string[] } {
	const warnings: string[] = [];
	let applied = 0;

	for (const [aliasId, targetId] of Object.entries(aliases)) {
		const existing = registry.get(aliasId);
		if (existing && !existing.aliasOf) {
			warnings.push(`[asset-aliases] alias "${aliasId}" conflicts with real asset (skipped)`);
			continue;
		}

		const target = registry.get(targetId);
		if (!target) {
			warnings.push(
				`[asset-aliases] alias "${aliasId}" targets unknown asset "${targetId}" (skipped)`,
			);
			continue;
		}

		if (target.aliasOf) {
			warnings.push(
				`[asset-aliases] alias "${aliasId}" targets another alias "${targetId}" (chains not allowed, skipped)`,
			);
			continue;
		}

		// Runtime-redirection alias: a pure POINTER, carrying no files/derived. `resolveAsset` follows
		// `aliasOf` to the target at read time, so an alias can never go stale when its target changes
		// (e.g. gets processed png→webp). The entry exists only so the alias id is discoverable.
		registry.set(aliasId, {
			id: aliasId,
			aliasOf: targetId,
			type: target.type,
			declaration: { type: target.type },
			basePath: target.basePath,
			manifestPath: target.manifestPath,
			files: [],
		});
		applied++;
	}

	for (const w of warnings) console.warn(w);
	return { applied, warnings };
}

// ─── File path resolution (pure reads of the build-time result) ───

/** The asset's primary bundle-able file path (empty string if it has none). */
export function resolveFilePath(asset: ResolvedAsset): string {
	return asset.files[0] ?? "";
}

/** Every bundle-able file path the asset references. */
export function resolveAllFilePaths(asset: ResolvedAsset): string[] {
	return asset.files;
}

/**
 * Resolve an id to its concrete asset, following an alias POINTER one hop (alias chains are forbidden
 * at alias-application time). Returns undefined if the id is unknown or the alias target is missing.
 * Use this instead of `registry.get(id)` wherever you then read files / derived / declaration — it is
 * how alias redirection happens at read time.
 */
export function resolveAsset(registry: AssetRegistry, id: string): ResolvedAsset | undefined {
	const entry = registry.get(id);
	if (!entry) return undefined;
	return entry.aliasOf ? registry.get(entry.aliasOf) : entry;
}
