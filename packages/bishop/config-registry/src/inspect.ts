import { type ConfigCategory, isIdCategory, isKeyCategory, type Manifest } from "./manifest.js";
import { collectRefs, type RefIndex } from "./refs.js";

/**
 * Forward-resolution indexes over a merged config — the read side that powers `expand`/`refs`.
 *   byId:      numeric id → entity (id-kind)
 *   byKey:     "category:keyValue" → entity (key-kind)
 *   categoryOf / keyFieldOf: id/entity → its category metadata
 */
export interface InspectContext {
	merged: Record<string, unknown>;
	manifest: Manifest;
	index: RefIndex;
	byId: Map<number, object>;
	byKey: Map<string, object>;
	categoryOfId: Map<number, string>;
}

export function buildInspectContext(
	merged: Record<string, unknown>,
	manifest: Manifest,
	index: RefIndex,
): InspectContext {
	const byId = new Map<number, object>();
	const byKey = new Map<string, object>(); // keyed `${category}::${keyField}:${value}`
	const categoryOfId = new Map<number, string>();
	// Which string keyFields to index per category (from the ref index + any key-kind identity).
	const keyFieldsByCategory = new Map<string, Set<string>>();
	for (const cat of manifest) if (isKeyCategory(cat)) addKeyField(keyFieldsByCategory, cat.name, cat.keyField);
	for (const { targets, keyField } of index.string.values()) {
		for (const t of targets) addKeyField(keyFieldsByCategory, t, keyField);
	}
	for (const { targets, keyField } of index.recordKey.values()) {
		for (const t of targets) addKeyField(keyFieldsByCategory, t, keyField);
	}
	for (const cat of manifest) {
		const arr = merged[cat.name];
		if (!Array.isArray(arr)) continue;
		for (const e of arr) {
			if (!e || typeof e !== "object") continue;
			if (isIdCategory(cat) && typeof (e as { id?: unknown }).id === "number") {
				const id = (e as { id: number }).id;
				byId.set(id, e);
				categoryOfId.set(id, cat.name);
			}
			for (const kf of keyFieldsByCategory.get(cat.name) ?? []) {
				const k = (e as Record<string, unknown>)[kf];
				if (typeof k === "string") byKey.set(`${cat.name}::${kf}:${k}`, e);
			}
		}
	}
	return { merged, manifest, index, byId, byKey, categoryOfId };
}

function addKeyField(m: Map<string, Set<string>>, cat: string, kf: string): void {
	const s = m.get(cat) ?? new Set<string>();
	s.add(kf);
	m.set(cat, s);
}

function metaFor(entity: { id?: number }, ctx: InspectContext, file: string | null) {
	const id = entity.id;
	return { id, category: id != null ? (ctx.categoryOfId.get(id) ?? null) : null, file };
}

function resolveKeyEntity(ctx: InspectContext, targets: string[], keyField: string, key: string): object | undefined {
	for (const t of targets) {
		const hit = ctx.byKey.get(`${t}::${keyField}:${key}`);
		if (hit) return hit;
	}
	return undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: expansion produces an arbitrary inlined tree.
type Any = any;

/** Expand a resolved entity: clone + inline its refs + stamp `_meta`; stub on re-encounter (cycle/shared). */
function expandEntity(entity: Any, ctx: InspectContext, seen: Set<string>): Any {
	const meta = metaFor(entity, ctx, null);
	const key = `${meta.category}:${entity.id ?? JSON.stringify(entity)}`;
	if (seen.has(key)) return { $ref: entity.id, _meta: meta };
	seen.add(key);
	const out = expandObject(entity, ctx, seen);
	out._meta = meta;
	return out;
}

function mapRefValue(value: Any, fn: (v: Any) => Any): Any {
	return Array.isArray(value) ? value.map(fn) : fn(value);
}

function expandObject(obj: Any, ctx: InspectContext, seen: Set<string>): Any {
	const out: Any = {};
	for (const [key, value] of Object.entries(obj)) {
		const numTargets = ctx.index.numeric.get(key);
		const strRef = ctx.index.string.get(key);
		if (numTargets) {
			out[key] = mapRefValue(value, (v) => {
				if (typeof v !== "number" || v === 0) return v;
				const target = ctx.byId.get(v);
				return target ? expandEntity(target, ctx, seen) : v; // dangling → raw id (validate reports it)
			});
		} else if (strRef) {
			out[key] = mapRefValue(value, (v) => {
				if (typeof v !== "string") return v;
				const target = resolveKeyEntity(ctx, strRef.targets, strRef.keyField, v);
				return target ? expandEntity(target, ctx, seen) : v;
			});
		} else if (Array.isArray(value)) {
			out[key] = value.map((v) => expandAny(v, ctx, seen));
		} else if (value && typeof value === "object") {
			out[key] = expandObject(value, ctx, seen);
		} else {
			out[key] = value;
		}
	}
	return out;
}

function expandAny(v: Any, ctx: InspectContext, seen: Set<string>): Any {
	if (Array.isArray(v)) return v.map((x) => expandAny(x, ctx, seen));
	if (v && typeof v === "object") return expandObject(v, ctx, seen);
	return v;
}

/** Expand entity `id` into a self-contained tree (refs inlined, each node `_meta`-stamped). Null if unknown. */
export function expand(id: number, ctx: InspectContext): Any {
	const entity = ctx.byId.get(id);
	if (!entity) return null;
	return expandEntity(entity, ctx, new Set());
}

export interface RefHit {
	fromId: number | null;
	fromKey: string | null;
	category: string;
	keys: string[];
	label: string;
}

/** Every entity that references `id` (numeric refs) or its key (string refs), reverse-walked. */
export function findRefs(id: number, ctx: InspectContext): RefHit[] {
	const target = ctx.byId.get(id) as Record<string, unknown> | undefined;
	// Collect the target's own string-key values (any keyField a string ref could resolve against) so
	// reverse-walk catches string refs pointing at it (perks.perkId, signatures.signatureId, boons.boonId, …).
	const targetKeys = new Set<string>();
	if (target) {
		for (const { keyField } of ctx.index.string.values()) {
			if (typeof target[keyField] === "string") targetKeys.add(target[keyField] as string);
		}
		for (const { keyField } of ctx.index.recordKey.values()) {
			if (typeof target[keyField] === "string") targetKeys.add(target[keyField] as string);
		}
	}
	const out: RefHit[] = [];
	for (const cat of ctx.manifest) {
		const arr = ctx.merged[cat.name];
		if (!Array.isArray(arr)) continue;
		for (const entity of arr) {
			const e = entity as Record<string, unknown>;
			if (typeof e.id === "number" && e.id === id) continue;
			const { numeric, string } = collectRefs(e, ctx.index);
			const keys = new Set<string>();
			for (const r of numeric) if (r.value === id) keys.add(r.key);
			for (const r of string) if (targetKeys.has(String(r.value))) keys.add(r.key);
			if (keys.size) {
				out.push({
					fromId: typeof e.id === "number" ? e.id : null,
					fromKey: isKeyCategory(cat) ? (e[cat.keyField] as string) ?? null : null,
					category: cat.name,
					keys: [...keys],
					label: (e.displayName as string) ?? String(e.id ?? ""),
				});
			}
		}
	}
	return out;
}

/** category → keyField, for building key-kind lookups (used by validation). */
export function keyFields(manifest: Manifest): Map<string, string> {
	const m = new Map<string, string>();
	for (const c of manifest) if (isKeyCategory(c)) m.set(c.name, c.keyField);
	return m;
}

export function categoryList(manifest: Manifest): ConfigCategory[] {
	return [...manifest];
}
