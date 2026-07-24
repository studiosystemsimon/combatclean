import { getAssetSchema } from "./formats.js";
import type { AssetManifestFile } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Validation — browser-safe entry points. These call the zod schema registered for
// each asset type (see registerAssetSchema); zod itself only enters the process via
// the schema objects, so importing THIS module without any schema registered is
// harmless (every declaration then reports "no schema registered").
//
// The fs-walking validateAssetsDir lives in ./node (it reads the disk tree).
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationError {
	/** Manifest file the error came from (set by validateAssetsDir). */
	file?: string;
	assetId?: string;
	type?: string;
	message: string;
}

/** Validate one declaration against the zod schema registered for its `type`. */
export function validateDeclaration(id: string, decl: unknown): ValidationError[] {
	if (!decl || typeof decl !== "object") {
		return [{ assetId: id, message: "declaration is not an object" }];
	}
	const type = (decl as { type?: unknown }).type;
	if (typeof type !== "string") {
		return [{ assetId: id, message: "declaration is missing a string `type`" }];
	}

	const schema = getAssetSchema(type);
	if (!schema) {
		return [{ assetId: id, type, message: `no schema registered for asset type "${type}"` }];
	}

	const result = schema.safeParse(decl);
	if (result.success) return [];
	return result.error.issues.map((issue) => ({
		assetId: id,
		type,
		message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
	}));
}

/** Validate a parsed `assets.json` (shape + every declaration). */
export function validateManifest(data: unknown): ValidationError[] {
	const errors: ValidationError[] = [];
	const manifest = data as Partial<AssetManifestFile> | null;
	if (!manifest || typeof manifest !== "object") {
		return [{ message: "manifest is not an object" }];
	}
	if (manifest.version !== 1) {
		errors.push({ message: `manifest version must be 1 (got ${String(manifest.version)})` });
	}
	if (!manifest.assets || typeof manifest.assets !== "object") {
		errors.push({ message: "manifest is missing an `assets` object" });
		return errors;
	}
	for (const [id, decl] of Object.entries(manifest.assets)) {
		errors.push(...validateDeclaration(id, decl));
	}
	return errors;
}
