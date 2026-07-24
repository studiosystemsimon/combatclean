import { z } from "zod";
import {
	ALL_MEMBERS_META,
	ALL_MEMBERS_TOKEN,
	CONFIG_REF_META,
	RECORD_KEY_REF_META,
	STRING_REF_META,
	type RefTarget,
} from "./base.js";
import { type ConfigCategory, isKeyCategory, type Manifest } from "./manifest.js";

/**
 * The reference index — the field-name → target map, DERIVED from the category schemas' configRef()/
 * stringConfigRef() metadata (not a hand-maintained list). This is what makes the schema the single
 * source of truth: a field is a ref because its schema says so, and it carries its target category.
 *
 *   numeric:   fieldName → target(s)                        (configRef; resolves an id-kind category by `id`)
 *   string:    fieldName → { targets, keyField, allowAll? } (stringConfigRef; resolves a key-kind by its key.
 *                                                            allowAll = the field accepts the "*" wildcard token)
 *   recordKey: fieldName → { targets, keyField }            (configRecord; the map's KEYS are string refs)
 *
 * We read the metadata off `z.toJSONSchema(schema)` — a stable public API that copies registered meta
 * into the output — resolving any `$ref`/`$defs` indirection Zod may hoist. Correlation is by field
 * NAME (proven robust by the legacy depth-walker): a `*ConfigId`-named ref means the same target
 * everywhere, and the naming lint keeps name ↔ helper in sync so a plain number is never mistaken for a ref.
 */
export interface RefIndex {
	numeric: Map<string, string[]>;
	string: Map<string, { targets: string[]; keyField: string; allowAll?: boolean }>;
	recordKey: Map<string, { targets: string[]; keyField: string }>;
}

// biome-ignore lint/suspicious/noExplicitAny: JSON-schema nodes are untyped by construction.
export type JsonNode = Record<string, any>;

function targetsOf(raw: RefTarget): string[] {
	return Array.isArray(raw) ? [...raw] : [raw as string];
}

/** Resolve a `{ $ref: "#/$defs/Foo" }` node against the document root; returns the node unchanged otherwise.
 *  Shared by the ref-index walker (here) and the deep-strict validator. */
export function deref(node: JsonNode, root: JsonNode): JsonNode {
	let cur = node;
	// Follow chains defensively (a $def may itself be a $ref).
	for (let i = 0; i < 16 && cur && typeof cur.$ref === "string"; i++) {
		const path = cur.$ref.replace(/^#\//, "").split("/");
		let target: JsonNode | undefined = root;
		for (const seg of path) target = target?.[seg];
		if (!target) break;
		cur = target;
	}
	return cur;
}

/** Walk a JSON-schema tree, invoking `visit(fieldName, node)` for every node carrying a ref meta key.
 *  `name` is the nearest enclosing property key (arrays/unions inherit their property's name). */
function walkSchema(
	node: JsonNode | undefined,
	name: string | undefined,
	root: JsonNode,
	visit: (name: string, node: JsonNode) => void,
	seen: Set<JsonNode>,
): void {
	if (!node || typeof node !== "object") return;
	const resolved = deref(node, root);
	if (seen.has(resolved)) return;
	seen.add(resolved);

	if (
		name &&
		(resolved[CONFIG_REF_META] !== undefined ||
			resolved[STRING_REF_META] !== undefined ||
			resolved[RECORD_KEY_REF_META] !== undefined)
	) {
		visit(name, resolved);
	}
	if (resolved.properties) {
		for (const [k, v] of Object.entries(resolved.properties)) walkSchema(v as JsonNode, k, root, visit, seen);
	}
	if (resolved.items) {
		const items = Array.isArray(resolved.items) ? resolved.items : [resolved.items];
		for (const it of items) walkSchema(it, name, root, visit, seen);
	}
	if (resolved.additionalProperties && typeof resolved.additionalProperties === "object") {
		walkSchema(resolved.additionalProperties, name, root, visit, seen);
	}
	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		if (Array.isArray(resolved[key])) for (const b of resolved[key]) walkSchema(b, name, root, visit, seen);
	}
}

/** Build the reference index from all category schemas. */
export function buildRefIndex(manifest: Manifest): RefIndex {
	const numeric = new Map<string, Set<string>>();
	const string = new Map<string, { targets: Set<string>; keyField: string; allowAll: boolean }>();
	const recordKey = new Map<string, { targets: Set<string>; keyField: string }>();

	const addNum = (name: string, targets: string[]) => {
		const set = numeric.get(name) ?? new Set<string>();
		for (const t of targets) set.add(t);
		numeric.set(name, set);
	};
	const addStr = (name: string, target: RefTarget, keyField: string, allowAll: boolean) => {
		const e = string.get(name) ?? { targets: new Set<string>(), keyField, allowAll: false };
		for (const t of targetsOf(target)) e.targets.add(t);
		if (allowAll) e.allowAll = true;
		string.set(name, e);
	};
	const addRecordKey = (name: string, target: RefTarget, keyField: string) => {
		const e = recordKey.get(name) ?? { targets: new Set<string>(), keyField };
		for (const t of targetsOf(target)) e.targets.add(t);
		recordKey.set(name, e);
	};

	for (const cat of manifest) {
		const json = z.toJSONSchema(cat.schema, { unrepresentable: "any", io: "input" }) as JsonNode;
		const root = json;
		walkSchema(json, undefined, root, (name, node) => {
			if (node[CONFIG_REF_META] !== undefined) addNum(name, targetsOf(node[CONFIG_REF_META]));
			if (node[STRING_REF_META] !== undefined) {
				const m = node[STRING_REF_META] as { target: RefTarget; keyField: string };
				addStr(name, m.target, m.keyField, node[ALL_MEMBERS_META] === true);
			}
			if (node[RECORD_KEY_REF_META] !== undefined) {
				const m = node[RECORD_KEY_REF_META] as { target: RefTarget; keyField: string };
				addRecordKey(name, m.target, m.keyField);
			}
		}, new Set());
	}

	return {
		numeric: new Map([...numeric].map(([k, v]) => [k, [...v]])),
		string: new Map(
			[...string].map(([k, v]) => [
				k,
				{ targets: [...v.targets], keyField: v.keyField, ...(v.allowAll ? { allowAll: true } : {}) },
			]),
		),
		recordKey: new Map([...recordKey].map(([k, v]) => [k, { targets: [...v.targets], keyField: v.keyField }])),
	};
}

export interface CollectedRef {
	key: string;
	value: number | string;
	targets: string[];
	/** For record-KEY refs (configRecord): the target keyField the value resolves against. Absent for
	 *  ordinary field refs (whose keyField is looked up by field name in RefIndex.string). */
	keyField?: string;
}

/** Recursively collect every cross-reference inside one entity, using the derived ref index. `0` (numeric)
 *  is the "none" sentinel and is skipped; the "*" wildcard token on an allowAll string ref is skipped
 *  (valid-by-definition). A value under a ref key may be a scalar or an array; both flatten. For a
 *  configRecord field, every KEY of the value object is collected as a string ref. */
export function collectRefs(
	entity: unknown,
	index: RefIndex,
): { numeric: CollectedRef[]; string: CollectedRef[] } {
	const numeric: CollectedRef[] = [];
	const string: CollectedRef[] = [];
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const v of node) visit(v);
			return;
		}
		if (node === null || typeof node !== "object") return;
		for (const [key, value] of Object.entries(node)) {
			const numTargets = index.numeric.get(key);
			if (numTargets) {
				for (const v of Array.isArray(value) ? value : [value]) {
					if (typeof v === "number" && v !== 0) numeric.push({ key, value: v, targets: numTargets });
				}
			}
			const strRef = index.string.get(key);
			if (strRef) {
				for (const v of Array.isArray(value) ? value : [value]) {
					// Skip the engine-owned wildcard token on an allowAll field — it is not a ref to resolve.
					if (typeof v === "string" && !(strRef.allowAll && v === ALL_MEMBERS_TOKEN)) {
						string.push({ key, value: v, targets: strRef.targets });
					}
				}
			}
			const recRef = index.recordKey.get(key);
			if (recRef && value && typeof value === "object" && !Array.isArray(value)) {
				for (const k of Object.keys(value)) {
					string.push({ key, value: k, targets: recRef.targets, keyField: recRef.keyField });
				}
			}
			if (value && typeof value === "object") visit(value);
		}
	};
	visit(entity);
	return { numeric, string };
}
