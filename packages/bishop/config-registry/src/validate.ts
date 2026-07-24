import { z } from "zod";
import { CONFIG_REF_META, STRING_REF_META } from "./base.js";
import { inLane } from "./allocate.js";
import { isIdCategory, isKeyCategory, type Manifest } from "./manifest.js";
import { buildRefIndex, collectRefs, deref, type JsonNode, type RefIndex } from "./refs.js";

/**
 * Validate a fully-merged config against the manifest — the ONE gate the build, the editor save path,
 * and the CLI all run (so "if it fails in one it fails in all"). Production-grade: collects EVERY error
 * (not fail-fast) with a readable `category #id path: message` line. Four passes:
 *   1. Shape + DEEP-STRICT — each entity against its category Zod schema, PLUS unknown-key rejection at
 *      EVERY depth (the schema is the SSOT of allowed fields; a nested typo is FATAL, not stripped).
 *   2. Id uniqueness — every id-kind id globally unique; every key-kind key unique within its category.
 *   3. Lane conformance — every id sits inside its category's lane (or extraIds).
 *   4. Referential integrity — every configRef resolves to an existing id of the right TARGET category;
 *      every stringConfigRef resolves to a key of the right target.
 */
export function validateMerged(
	merged: Record<string, unknown>,
	manifest: Manifest,
	refIndex?: RefIndex,
): { errors: string[] } {
	const errors: string[] = [];
	const index = refIndex ?? buildRefIndex(manifest);

	// Build id + key sets for uniqueness + ref resolution.
	const idsByCategory = new Map<string, Set<number>>();
	const keysByCategory = new Map<string, Set<string>>();
	const globalIds = new Map<number, string>();

	for (const cat of manifest) {
		const raw = merged[cat.name];
		// id/key → the entity array; singleton → its value (object → [value], array → the array).
		const list = Array.isArray(raw)
			? raw
			: cat.kind === "singleton" && raw != null && typeof raw === "object"
				? [raw]
				: [];

		// 1. Shape + DEEP-STRICT keys. An undeclared key at ANY depth (a typo like `body.maxHelth`, dead
		//    data) is FATAL — the schema is the SSOT of allowed fields, not silently stripped.
		const catJson = z.toJSONSchema(cat.schema, { unrepresentable: "any", io: "input" }) as JsonNode;
		for (const entry of list) {
			const label = entryLabel(entry, cat);
			const result = cat.schema.safeParse(entry);
			if (!result.success) {
				for (const issue of result.error.issues) {
					errors.push(`${cat.name} ${label}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
				}
			}
			for (const path of unknownKeys(entry, catJson)) {
				errors.push(`${cat.name} ${label}: unknown field "${path}" (not declared in the ${cat.name} schema)`);
			}
		}

		// 2 + 3. Ids / keys / lane.
		if (isIdCategory(cat)) {
			const ids = new Set<number>();
			for (const entry of list) {
				const id = (entry as { id?: unknown }).id;
				if (typeof id !== "number") continue;
				if (ids.has(id)) errors.push(`${cat.name} #${id}: duplicate id within category`);
				ids.add(id);
				const prev = globalIds.get(id);
				if (prev !== undefined && prev !== cat.name) {
					errors.push(`#${id}: globally duplicate id across "${cat.name}" and "${prev}"`);
				}
				globalIds.set(id, cat.name);
				if (!inLane(cat, id)) {
					errors.push(`${cat.name} #${id}: out of lane ${cat.idRange[0]}-${cat.idRange[1]} (widen idRange or use extraIds)`);
				}
			}
			idsByCategory.set(cat.name, ids);
		} else if (isKeyCategory(cat)) {
			const keys = new Set<string>();
			for (const entry of list) {
				const k = (entry as Record<string, unknown>)[cat.keyField];
				if (typeof k !== "string") continue;
				if (keys.has(k)) errors.push(`${cat.name} "${k}": duplicate ${cat.keyField} within category`);
				keys.add(k);
			}
			keysByCategory.set(cat.name, keys);
		}
	}

	// String-ref key sets: `${category}::${keyField}` → Set<string>, built from the ref index's declared
	// keyFields (a string ref may target an id-kind category by a non-identity string key, e.g. perks.perkId).
	// Both ordinary string refs AND configRecord key-refs contribute their (target, keyField) pairs.
	const stringKeySets = new Map<string, Set<string>>();
	const buildKeySet = (targets: string[], keyField: string) => {
		for (const t of targets) {
			const mk = `${t}::${keyField}`;
			if (stringKeySets.has(mk)) continue;
			const set = new Set<string>();
			for (const e of Array.isArray(merged[t]) ? (merged[t] as Record<string, unknown>[]) : []) {
				if (typeof e[keyField] === "string") set.add(e[keyField] as string);
			}
			stringKeySets.set(mk, set);
		}
	};
	for (const { targets, keyField } of index.string.values()) buildKeySet(targets, keyField);
	for (const { targets, keyField } of index.recordKey.values()) buildKeySet(targets, keyField);

	// 4. Referential integrity (id/key entities + singleton values — refs inside singletons validated too).
	for (const cat of manifest) {
		const raw = merged[cat.name];
		const entries = Array.isArray(raw)
			? raw
			: cat.kind === "singleton" && raw != null && typeof raw === "object"
				? [raw]
				: [];
		for (const entry of entries) {
			const label = entryLabel(entry, cat);
			const { numeric, string } = collectRefs(entry, index);
			for (const ref of numeric) {
				if (!ref.targets.some((t) => idsByCategory.get(t)?.has(ref.value as number))) {
					errors.push(`${cat.name} ${label}: ${ref.key}=${ref.value} → no ${ref.targets.join("/")} with that id`);
				}
			}
			for (const ref of string) {
				// record-key refs carry their own keyField; ordinary field refs look it up by field name.
				const kf = ref.keyField ?? index.string.get(ref.key)?.keyField ?? "";
				if (!ref.targets.some((t) => stringKeySets.get(`${t}::${kf}`)?.has(ref.value as string))) {
					errors.push(`${cat.name} ${label}: ${ref.key}="${ref.value}" → no ${ref.targets.join("/")} with ${kf} "${ref.value}"`);
				}
			}
		}
	}

	return { errors };
}

/** Throwing wrapper — the FATAL gate for build/editor/CLI. */
export function assertValidMerged(merged: Record<string, unknown>, manifest: Manifest, refIndex?: RefIndex): void {
	const { errors } = validateMerged(merged, manifest, refIndex);
	if (errors.length) {
		const shown = errors.slice(0, 40).join("\n  ");
		const more = errors.length > 40 ? `\n  …+${errors.length - 40} more` : "";
		throw new Error(`[config] validation failed (${errors.length}):\n  ${shown}${more}`);
	}
}

// ── Deep-strict: reject unknown keys at every depth, driven by the schema's JSON-schema form ──
// `JsonNode` + `deref` are shared from ./refs (same JSON-schema shape both modules walk).

/** For a union, pick the branch whose discriminator const(s) match the data — else null (conservative:
 *  a plain/ambiguous union is skipped so we never false-flag). Handles Zod discriminatedUnion (each branch
 *  carries a `const` on the discriminator property). */
function pickBranch(data: JsonNode, branches: JsonNode[], root: JsonNode): JsonNode | null {
	for (const raw of branches) {
		const b = deref(raw, root);
		const props = b.properties as Record<string, JsonNode> | undefined;
		if (!props) continue;
		let hasConst = false;
		let match = true;
		for (const [k, sub] of Object.entries(props)) {
			if (sub && sub.const !== undefined) {
				hasConst = true;
				if (data[k] !== sub.const) {
					match = false;
					break;
				}
			}
		}
		if (hasConst && match) return b;
	}
	return null;
}

/** Collect data key-paths not declared by the schema, recursively. Skips OPEN nodes (z.record / loose /
 *  opaque z.custom → no closed key set) and, for unions, only descends the branch the data's discriminator
 *  selects — so it never false-flags. Closed objects (z.object strip OR strict) reject unknown keys. */
function unknownKeys(data: unknown, schemaRoot: JsonNode): string[] {
	const out: string[] = [];
	const walk = (d: unknown, node: JsonNode | undefined, path: string): void => {
		if (!d || typeof d !== "object" || !node) return;
		const n = deref(node, schemaRoot);
		if (!n || typeof n !== "object") return;

		const branches = n.anyOf ?? n.oneOf;
		if (Array.isArray(branches)) {
			const b = pickBranch(d as JsonNode, branches, schemaRoot);
			if (b) walk(d, b, path); // matched discriminated branch → strict; else conservative skip
			return;
		}
		if (Array.isArray(n.allOf)) {
			for (const b of n.allOf) walk(d, b, path); // intersection: value-level only, no top-key flag
			return;
		}
		if (Array.isArray(d)) {
			if (n.items) {
				const items = Array.isArray(n.items) ? n.items : [n.items];
				for (const el of d) for (const it of items) walk(el, it, `${path}[]`);
			}
			return;
		}
		const props = n.properties as Record<string, JsonNode> | undefined;
		if (props) {
			// A closed object (strip or strict) emits additionalProperties:false/absent; a loose object emits
			// true. Only flag unknown keys when NOT explicitly open.
			const open = n.additionalProperties === true;
			for (const [k, v] of Object.entries(d as JsonNode)) {
				const sub = props[k];
				if (sub === undefined) {
					if (!open) out.push(path ? `${path}.${k}` : k);
				} else {
					walk(v, sub, path ? `${path}.${k}` : k);
				}
			}
		} else if (n.additionalProperties && typeof n.additionalProperties === "object") {
			// z.record — dynamic keys are allowed; recurse each value's shape.
			for (const [k, v] of Object.entries(d as JsonNode)) walk(v, n.additionalProperties, `${path}.${k}`);
		}
	};
	walk(data, schemaRoot, "");
	return out;
}

function entryLabel(entry: unknown, cat: { kind: string; name: string; keyField?: string }): string {
	const e = entry as Record<string, unknown>;
	if (cat.kind === "singleton") return `(${cat.name})`;
	if (cat.kind === "key" && cat.keyField) return `"${String(e[cat.keyField] ?? "?")}"`;
	return `#${String(e.id ?? "?")}`;
}

/**
 * Naming lint: keep the human `*ConfigId(s)` convention in sync with the schema. A numeric configRef MUST
 * be named `*ConfigId` (or `*ConfigIds`). String refs are named after the target's key field by convention
 * (perkId → perks.perkId), so they're exempt.
 */
export function lintRefNaming(manifest: Manifest): string[] {
	const index = buildRefIndex(manifest);
	const out: string[] = [];
	for (const name of index.numeric.keys()) {
		// Accept `*ConfigId(s)` and the canonical generic grant ref `configId(s)`.
		if (!/[Cc]onfigIds?$/.test(name)) out.push(`configRef field "${name}" must be named *ConfigId or *ConfigIds`);
	}
	return out;
}

export { buildRefIndex, CONFIG_REF_META, STRING_REF_META };
