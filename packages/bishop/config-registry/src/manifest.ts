import type { z } from "zod";

/**
 * A game declares its content format as a `ConfigCategory[]` manifest — the SSOT the engine is generic
 * over (replaces the old hardcoded ID_BLOCKS + CATEGORY_MAP + CONFIG_SCHEMAS + NUMERIC_REF_KEYS). Two
 * kinds, each mapped to ONE fixed folder under `config/game/`:
 *
 *   - id-kind    → globally-unique numeric `id`, auto-allocated per lane, never reused. Referenced by configRef().
 *   - key-kind   → an intrinsic enum-derived key (`keyField`); no id, no allocation. Referenced by stringConfigRef().
 *   - singleton  → a single game-global config value (a `_global.json` block like `economy`/`battlepass`,
 *                  or an array like `meals`/`crossroadsEvents`). No id/lane; validated (schema + deep-strict
 *                  + refs) by the SAME engine, so there is ONE validation path — no hand-written validators.
 */
export type ConfigCategory = IdCategory | KeyCategory | SingletonCategory;

export interface IdCategory {
	kind: "id";
	/** Merged-config property name + logical category name (e.g. "enemies"). */
	name: string;
	/** The single folder under config/game/ holding this category's per-entity JSON (e.g. "enemies"). */
	folder: string;
	/** Zod schema for one entity — extends zConfig; refs declared via configRef()/stringConfigRef(). */
	schema: z.ZodType;
	/** Allocation lane [min, max] + gross-misfile range guard. */
	idRange: [number, number];
	/** Individually-allowed out-of-lane ids (deliberate sandbox/preview entities). */
	extraIds?: number[];
}

export interface KeyCategory {
	kind: "key";
	name: string;
	folder: string;
	schema: z.ZodType;
	/** The entity field holding this category's intrinsic enum-derived key (e.g. "element", "rankKey"). */
	keyField: string;
}

export interface SingletonCategory {
	kind: "singleton";
	/** The merged-config / `_global.json` key holding this value (e.g. "economy", "meals"). */
	name: string;
	/** Zod schema for the value (an object), or for EACH element when `array` is true. */
	schema: z.ZodType;
	/** true = `merged[name]` is an array (validate each element); false/absent = a single object. */
	array?: boolean;
}

export type Manifest = readonly ConfigCategory[];

export function isIdCategory(c: ConfigCategory): c is IdCategory {
	return c.kind === "id";
}
export function isKeyCategory(c: ConfigCategory): c is KeyCategory {
	return c.kind === "key";
}
export function isSingletonCategory(c: ConfigCategory): c is SingletonCategory {
	return c.kind === "singleton";
}

/** Index the manifest by category name for O(1) lookup. */
export function byName(manifest: Manifest): Map<string, ConfigCategory> {
	return new Map(manifest.map((c) => [c.name, c]));
}
