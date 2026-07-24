import { z } from "zod";

/**
 * @bishop/config-registry — the game-AGNOSTIC logical-config system. It owns the CONTRACT and the
 * mechanics (id allocation, reference integrity, validation, inspection, CLI); a game supplies its
 * own content format (a `ConfigCategory[]` manifest of Zod schemas) and its data (`config/game/**`).
 * Twin of @bishop/asset-registry — assets are opaque there because they have no schema; here every
 * category HAS a schema, so the schema is the single source of truth for shape AND references.
 *
 * The contract every entity honours:
 *   - id-kind   → { id: number, displayName, tags? }  (zConfig)   — globally-unique numeric id.
 *   - key-kind  → { displayName, tags? } + an enum-derived key    (zKeyConfig) — no numeric id.
 *   - references are DECLARED IN THE SCHEMA via configRef()/stringConfigRef(), not inferred from
 *     field names. The `*ConfigId(s)` naming stays as an enforced lint (see lintRefNaming).
 */

/** Base identity for an ID-KIND config entity: a globally-unique numeric id + a human label.
 *  `tags` is optional organizational `"key:value"` metadata (UI grouping/search) — never gate logic on it. */
export const zConfig = z.object({
	id: z
		.number()
		.int()
		.describe("Globally-unique numeric id (allocated per category lane; never reused)."),
	displayName: z.string().describe("Human-readable label shown in the editor/UI."),
	tags: z
		.record(z.string(), z.string())
		.optional()
		.describe('UI/design grouping metadata (key→value), for presentation filtering/search only. NEVER filter game logic on a tag: if you need to branch on a clearly-defined set, that set is an enum — model it as a typed field or a keyConfig + ref, not a tag.'),
});

/** Base identity for a KEY-KIND config entity: identified by an intrinsic enum-derived `key` (the
 *  runtime reference), NOT a numeric id. The `key` field is enforced HERE (always named "key" — the
 *  manifest's `keyField` must be "key"). displayName is OPTIONAL: a key-kind entry's human/UI text
 *  belongs in UIConfig, not the logical config — the key string is the identity + the loc-key stem. */
export const zKeyConfig = z.object({
	key: z.string().describe("Intrinsic enum-derived identity key — the runtime reference AND the config file name. Always named 'key'. No displayName: UI text (name/colour/icon) belongs in UIConfig, keyed by this key."),
	tags: z.record(z.string(), z.string()).optional().describe('UI/design grouping metadata (key→value), presentation only. NEVER filter game logic on a tag — a set you branch on is an enum (typed field / keyConfig + ref).'),
});

export type Config = z.infer<typeof zConfig>;
export type KeyConfig = z.infer<typeof zKeyConfig>;

/** A reference target: one category name, or a union of category names ("resolves if it exists in ANY"). */
export type RefTarget = string | readonly string[];

/** The metadata keys configRef()/stringConfigRef() stamp; read back off `z.toJSONSchema` output. */
export const CONFIG_REF_META = "configRef";
export const STRING_REF_META = "stringConfigRef";
/** Marks a `z.record` whose KEYS are string refs into a category (configRecord). */
export const RECORD_KEY_REF_META = "recordKeyRef";
/** Marks a string ref that ALSO accepts the reserved "all members" token (stringConfigRefOrAll). */
export const ALL_MEMBERS_META = "allMembers";
/** The reserved, engine-owned token meaning "every member of the target category". Not a real key —
 *  the collector never treats it as a ref and validation never flags it as dangling. */
export const ALL_MEMBERS_TOKEN = "*";

/**
 * Declare a NUMERIC reference to an id-kind category. The schema — not the field name — is the source
 * of truth: this stamps `.meta({ configRef: target })`, which the engine reads (via `z.toJSONSchema`)
 * to build the ref index used by validation, `expand`, and `refs`. For an array of refs wrap it:
 * `z.array(configRef("dropTables"))`. `0` is the universal "none" sentinel (absence, not a dangling ref).
 */
export function configRef(target: RefTarget) {
	return z.number().int().meta({ [CONFIG_REF_META]: target });
}

/**
 * Declare a STRING reference to another category resolved against a named string `keyField` on the
 * target (e.g. `stringConfigRef("perks", "perkId")`, `stringConfigRef("elements", "element")`). Works
 * for a key-kind target (its identity key) AND an id-kind target that also exposes a string key
 * (perks.perkId / signatures.signatureId / boons.boonId). Same "refs live in the schema" principle.
 */
export function stringConfigRef(target: RefTarget, keyField: string) {
	return z.string().meta({ [STRING_REF_META]: { target, keyField } });
}

/**
 * Declare a RECORD (map) whose KEYS are string references into `target` (resolved against its `keyField`),
 * with `valueSchema` for the values. The engine validates every key as a ref (dangling keys are FATAL) and
 * surfaces them in `expand`/`refs` — closing the gap where `z.record(z.string(), …)` left map keys
 * (rarity weights, modifier synergy tables) validated only at runtime, or not at all. Example:
 * `configRecord("rarities", "key", z.number())` — `{ common: 15, rare: 40 }` with `common`/`rare` checked
 * against the rarities category.
 */
export function configRecord<V extends z.ZodType>(target: RefTarget, keyField: string, valueSchema: V) {
	return z.record(z.string(), valueSchema).meta({ [RECORD_KEY_REF_META]: { target, keyField } });
}

/**
 * Like `stringConfigRef`, but ALSO accepts the reserved wildcard token `"*"` (`ALL_MEMBERS_TOKEN`) meaning
 * "every member of the target category". The token is engine-owned: the ref collector skips it and
 * validation treats it as valid-by-definition (never dangling). Use it as a scalar OR inside an array
 * (`z.array(stringConfigRefOrAll("gearSlots", "key"))` → `["*"]` = all, `["head","chest"]` = those). At read
 * time expand the value with `resolveRefOrAll`. Replaces `literal('all') | ref` unions and null/absent
 * "means all" sentinels with a single, self-documenting, VALIDATED value.
 */
export function stringConfigRefOrAll(target: RefTarget, keyField: string) {
	return z.string().meta({ [STRING_REF_META]: { target, keyField }, [ALL_MEMBERS_META]: true });
}

/**
 * Resolve a ref-or-all value (a scalar or an array of `stringConfigRefOrAll` values) to a concrete list of
 * member keys. If the wildcard token `"*"` appears, returns ALL `allKeys`; otherwise the literal keys given.
 * `allKeys` is the target category's current key set (the consumer supplies it — the engine has no runtime).
 */
export function resolveRefOrAll(value: string | string[] | null | undefined, allKeys: readonly string[]): string[] {
	const vals = value == null ? [] : Array.isArray(value) ? value : [value];
	return vals.includes(ALL_MEMBERS_TOKEN) ? [...allKeys] : vals;
}

/** Read a config tag value by key, or undefined. UI/design grouping metadata only — never for logic. */
export function getTagValue(tags: Record<string, string> | undefined, key: string): string | undefined {
	return tags?.[key];
}
