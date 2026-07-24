// ─────────────────────────────────────────────────────────────────────────────
// Format registry — the ONE extension point of the agnostic asset database.
//
// A format teaches the registry a `type` in two independent halves, deliberately
// split so validation (which pulls zod) never reaches the client bundle:
//
//   • registerAssetFileExtractor(type, fn)  — RUNTIME. How to resolve the type's
//     bundle-able files (+ opaque derived metadata) from its declaration. No zod.
//     The generated virtual module imports the format's runtime entry.
//
//   • registerAssetSchema(type, zodSchema)  — BUILD / AUTHORING. The zod schema
//     that validates a declaration of this type. Imported only by the CLI and the
//     vite plugin, never by the client.
//
// Adding a new format = a new package that calls these. NEVER edit this file to
// add a `type`.
// ─────────────────────────────────────────────────────────────────────────────

// Type-only import — erased at compile time, so no zod in the runtime bundle.
import type { ZodType } from "zod";
import type { AssetDeclaration } from "./types.js";

export interface ExtractorContext {
	/** basePath of the declaring manifest (forward-slashed, ends with "/"). */
	basePath: string;
	/**
	 * Read a sidecar text file by path (relative to the assets root). fs-backed at
	 * scan time, baked-map-backed at runtime. Lets an extractor follow indirection
	 * (e.g. a Tiled `.tsx` that points at a `.png`). Undefined if unavailable.
	 */
	readText?: (relPath: string) => string | undefined;
}

export interface ExtractorResult {
	/** Bundle-able file paths (relative to the assets root) this asset needs at runtime. */
	files: string[];
	/** Opaque per-type metadata to stash on `ResolvedAsset.derived`. */
	derived?: Record<string, unknown>;
}

export type AssetFileExtractor = (
	declaration: AssetDeclaration,
	ctx: ExtractorContext,
) => ExtractorResult;

const extractors = new Map<string, AssetFileExtractor>();
const schemas = new Map<string, ZodType>();

/** Register the runtime file/metadata extractor for an asset `type`. */
export function registerAssetFileExtractor(type: string, fn: AssetFileExtractor): void {
	extractors.set(type, fn);
}

export function getAssetFileExtractor(type: string): AssetFileExtractor | undefined {
	return extractors.get(type);
}

/** Register the zod validation schema for an asset `type` (build/authoring only). */
export function registerAssetSchema(type: string, schema: ZodType): void {
	schemas.set(type, schema);
}

export function getAssetSchema(type: string): ZodType | undefined {
	return schemas.get(type);
}

/** Every type that has EITHER a schema or an extractor registered. */
export function listAssetTypes(): string[] {
	return [...new Set([...extractors.keys(), ...schemas.keys()])];
}

/** Test/introspection helper — drop all registered formats. */
export function clearAssetFormats(): void {
	extractors.clear();
	schemas.clear();
}

// ─── Convention-based default extraction (format-agnostic) ───

const MEDIA_EXT =
	/\.(png|jpe?g|gif|webp|avif|svg|mp3|ogg|wav|m4a|glb|gltf|fbx|ktx2|basis|tsx|tmx)$/i;
const FILE_KEYS = new Set(["file", "files", "folder", "path", "src", "source"]);

/**
 * Default file discovery when a type has no registered extractor: recursively walk
 * the declaration and collect every string that is either (a) under a file-ish key
 * (`file`/`files`/`folder`/…) or (b) shaped like a media path. basePath-prefixed.
 * No per-type knowledge — a type that needs indirection registers its own extractor.
 */
export function conventionExtractor(
	declaration: AssetDeclaration,
	ctx: ExtractorContext,
): ExtractorResult {
	const files = new Set<string>();
	const visit = (value: unknown, keyIsFileish: boolean): void => {
		if (typeof value === "string") {
			if (value && (keyIsFileish || MEDIA_EXT.test(value))) files.add(ctx.basePath + value);
		} else if (Array.isArray(value)) {
			for (const v of value) visit(v, keyIsFileish);
		} else if (value && typeof value === "object") {
			for (const [k, v] of Object.entries(value)) visit(v, FILE_KEYS.has(k.toLowerCase()));
		}
	};
	for (const [k, v] of Object.entries(declaration)) {
		if (k === "type") continue; // the discriminator is not a path
		visit(v, FILE_KEYS.has(k.toLowerCase()));
	}
	return { files: [...files] };
}

/** Run the registered extractor for a declaration's type, or the convention walker. */
export function extractAssetFiles(
	declaration: AssetDeclaration,
	ctx: ExtractorContext,
): ExtractorResult {
	const fn = extractors.get(declaration.type) ?? conventionExtractor;
	return fn(declaration, ctx);
}
