// ─────────────────────────────────────────────────────────────────────────────
// @bishop/asset-registry — browser-safe surface (no node:fs, no zod runtime).
// The fs-walking scan + validation live in "@bishop/asset-registry/node"; the Vite
// plugin in "@bishop/asset-registry/vite".
// ─────────────────────────────────────────────────────────────────────────────

export type {
	AliasManifest,
	AssetDeclaration,
	AssetManifestFile,
	AssetRegistry,
	ResolvedAsset,
} from "./types.js";

export {
	applyAliases,
	buildRegistryFromManifests,
	resolveAllFilePaths,
	resolveAsset,
	resolveFilePath,
	type BuildOptions,
} from "./scanner.js";

export {
	type AssetFileExtractor,
	type ExtractorContext,
	type ExtractorResult,
	clearAssetFormats,
	conventionExtractor,
	extractAssetFiles,
	getAssetFileExtractor,
	getAssetSchema,
	listAssetTypes,
	registerAssetFileExtractor,
	registerAssetSchema,
} from "./formats.js";

export { collectAssetIds, requiredFilesFor } from "./required.js";

// Pure POSIX path helper shared by the format-package extractors (asset-types-2d's tsx/fnt image
// resolution, asset-types-3d's gltf sidecar resolution). It has no format knowledge, so its one home
// is here in the shared base rather than duplicated per format package.
export { resolvePosixRelative } from "./paths.js";

export { type ValidationError, validateDeclaration, validateManifest } from "./validate.js";
