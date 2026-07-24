// ─────────────────────────────────────────────────────────────────────────────
// Agnostic asset database — the content of an asset is OPAQUE to this package.
//
// The only fixed shape is: an asset has a string `type` discriminator; everything
// else in the declaration is up to whoever defined that `type`. A format package
// (e.g. @bishop/asset-types-2d) teaches the registry a `type` by REGISTERING a zod
// schema (validation) and a file extractor (runtime resolution). The core never
// grows a `type` switch. See ./formats.
// ─────────────────────────────────────────────────────────────────────────────

/** An opaque asset declaration: a `type` tag plus arbitrary, format-defined content. */
export interface AssetDeclaration {
	type: string;
	[key: string]: unknown;
}

/** The `assets.json` schema. */
export interface AssetManifestFile {
	version: 1;
	assets: Record<string, AssetDeclaration>;
}

/** A registry entry: the declaration plus everything the build resolved about it. */
export interface ResolvedAsset {
	id: string;
	/** Mirrors `declaration.type` for convenient dispatch without touching the opaque body. */
	type: string;
	declaration: AssetDeclaration;
	/** Folder of the `assets.json` that declared this asset (forward-slashed, ends with "/"). */
	basePath: string;
	/** Path to the declaring `assets.json`, normalized to "/". */
	manifestPath: string;
	/** When present, this entry is an alias pointing at the real asset with this ID. */
	aliasOf?: string;
	/**
	 * All bundle-able file paths this asset references (relative to the assets root),
	 * computed at build time by the type's registered extractor (or the convention
	 * walker). `files[0]` is the primary file.
	 */
	files: string[];
	/**
	 * Opaque per-type metadata computed at build time by an extractor (e.g. parsed
	 * tileset dimensions). The core never inspects its shape; format packages own it.
	 */
	derived?: Record<string, unknown>;
}

export type AssetRegistry = Map<string, ResolvedAsset>;

/** Maps alias IDs to real asset IDs. */
export type AliasManifest = Record<string, string>;
