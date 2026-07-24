import { resolveAsset } from "./scanner.js";
import type { AssetRegistry } from "./types.js";

/**
 * Recursively collect every `*AssetId` string value from a config object.
 *
 * Convention (see Architecture_overview.md → "ID and reference rules"): ANY field
 * whose name (lowercased) ends with "assetid" is a single asset reference — `assetId`,
 * `iconAssetId`, `spriteAssetId`, `tilesetAssetId`, … — and any field ending in
 * "assetids" is an ARRAY of asset references (`animationRigAssetIds`, …). New config
 * fields need no edit here; they just follow the suffix. This is the seam that makes
 * "package only the assets a build actually uses" possible without hardcoded paths.
 */
export function collectAssetIds(obj: unknown, ids: Set<string> = new Set()): Set<string> {
	if (Array.isArray(obj)) {
		for (const item of obj) collectAssetIds(item, ids);
	} else if (obj && typeof obj === "object") {
		for (const [key, value] of Object.entries(obj)) {
			const lower = key.toLowerCase();
			if (lower.endsWith("assetids") && Array.isArray(value)) {
				for (const v of value) if (typeof v === "string" && v) ids.add(v);
			} else if (lower.endsWith("assetid") && typeof value === "string" && value) {
				ids.add(value);
			} else {
				collectAssetIds(value, ids);
			}
		}
	}
	return ids;
}

/**
 * Given a resolved registry and a set of asset ids, return the deduped list of every file path those
 * assets need — the trim set for a build. Alias ids are followed to their target (via `resolveAsset`),
 * so referencing an asset by an alias still pulls the real files.
 */
export function requiredFilesFor(registry: AssetRegistry, ids: Iterable<string>): string[] {
	const paths = new Set<string>();
	for (const id of ids) {
		const asset = resolveAsset(registry, id);
		if (!asset) continue;
		for (const f of asset.files) paths.add(f);
	}
	return [...paths];
}
