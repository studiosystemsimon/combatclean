// ─────────────────────────────────────────────────────────────────────────────
// Node-only entry — walks the assets directory on disk. Kept out of the "." export
// so the browser bundle never pulls node:fs. Consumed by the vite plugin and CLI.
//
// NOTE: extractors/schemas must be registered (import the relevant @bishop/asset-types-*
// entry) BEFORE calling these, or file resolution falls back to the convention walker
// and validation reports every type as "no schema registered".
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyAliases, buildRegistryFromManifests } from "./scanner.js";
import type { AliasManifest, AssetManifestFile, AssetRegistry } from "./types.js";
import { type ValidationError, validateManifest } from "./validate.js";

// Build-time asset-processing system (map/fold pipeline). Build-only — carries zod + node:fs.
export {
	type AssetInputSpec,
	type AssetProcessor,
	type AssetSelector,
	clearAssetProcessors,
	type FoldProcessor,
	type FoldResult,
	getAssetProcessor,
	getAssetProcessors,
	globToRegExp,
	type MapProcessor,
	type MapResult,
	matchSelector,
	type NamedBytes,
	PROCESSED_PREFIX,
	type Pipeline,
	type ProcessingConfig,
	type ProcessingHost,
	processRegistry,
	registerAssetProcessor,
	zAssetSelector,
	zProcessingConfig,
} from "./processing.js";

const MANIFEST = "assets.json";
const ALIASES = "aliases.json";

function readJson(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf-8"));
}

/** Forward-slashed path of `full` relative to `root`. */
function relPath(full: string, root: string): string {
	return full.slice(root.length + 1).replace(/\\/g, "/");
}

function walk(dir: string, onManifest: (full: string) => void): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, onManifest);
		else if (entry.name === MANIFEST) onManifest(full);
	}
}

export interface ScanResult {
	manifests: { path: string; data: AssetManifestFile }[];
	aliases: AliasManifest;
	registry: AssetRegistry;
	/** Deduped union of every bundle-able file path across the registry. */
	files: string[];
	/** Sidecar texts an extractor read (e.g. `.tsx`), keyed by rel path — baked for runtime. */
	fileContents: Record<string, string>;
}

/**
 * Scan `root` for every `assets.json` + the single root `aliases.json`, build the
 * resolved registry, and collect the file set to bundle. Records any sidecar text an
 * extractor reads (via readText) so the same extractor can run at runtime off baked data.
 */
export function scanAssetsDir(root: string): ScanResult {
	const manifests: { path: string; data: AssetManifestFile }[] = [];
	walk(root, (full) => {
		const data = readJson(full) as AssetManifestFile;
		if (!data?.version || !data.assets) return;
		manifests.push({ path: relPath(full, root), data });
	});

	const fileContents: Record<string, string> = {};
	const readText = (rel: string): string | undefined => {
		const abs = resolve(root, rel);
		if (!existsSync(abs)) return undefined;
		const text = readFileSync(abs, "utf-8");
		fileContents[rel] = text;
		return text;
	};

	const registry = buildRegistryFromManifests(manifests, { readText });

	let aliases: AliasManifest = {};
	const aliasesPath = resolve(root, ALIASES);
	if (existsSync(aliasesPath)) {
		try {
			aliases = readJson(aliasesPath) as AliasManifest;
		} catch {
			/* skip malformed */
		}
	}
	applyAliases(registry, aliases);

	const files = new Set<string>();
	for (const asset of registry.values()) {
		for (const f of asset.files) files.add(f);
	}

	return { manifests, aliases, registry, files: [...files], fileContents };
}

/** Validate every `assets.json` under `root`; errors are tagged with their file. */
export function validateAssetsDir(root: string): ValidationError[] {
	const errors: ValidationError[] = [];
	walk(root, (full) => {
		const file = relPath(full, root);
		let data: unknown;
		try {
			data = readJson(full);
		} catch (e) {
			errors.push({ file, message: `invalid JSON: ${(e as Error).message}` });
			return;
		}
		for (const err of validateManifest(data)) errors.push({ ...err, file });
	});
	return errors;
}
