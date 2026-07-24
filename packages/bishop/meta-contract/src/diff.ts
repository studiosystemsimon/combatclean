import type { AccountPatch } from "./patch.js";

// Structural diff → AccountPatch, for OWN-TABLE FEATURES (the run) that sync a whole server-owned document
// to the client mirror as a DELTA. The account emits explicit ops (atomic `inc` + intent audit under
// concurrency); an own-table feature is single-writer + server-authoritative, so a structural diff is the
// scalable best-practice: only CHANGED subtrees ride the wire, and it's impossible to forget an op.
//
// INVARIANT: applyPatch(prev, diffToPatch(prev, next)) deep-equals next. Objects recurse per key; arrays +
// primitives are ATOMIC (a changed value → one `set` of the whole value) — right for the run's small arrays
// (boons / completed / topology), and it sidesteps fragile per-element array diffing. A key present in `prev`
// but gone in `next` is set to null (applyPatch has no key-delete op; own-table feature views keep stable
// keys, so null is the faithful "absent" — activeNode: object → null when a node clears).

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Structural deep-equality (JSON-value shaped: primitives, arrays, plain objects). Used to decide whether a
// subtree changed at all before emitting a set. undefined === undefined (an absent key).
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
		return true;
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const ak = Object.keys(a);
		const bk = Object.keys(b);
		if (ak.length !== bk.length) return false;
		for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
		return true;
	}
	return false;
}

function joinPath(base: string, key: string): string {
	return base ? `${base}/${key}` : key;
}

// Diff `prev` → `next` into a minimal patch. `prev` null/undefined ⇒ a first snapshot (every key is a set,
// building the document from empty). Recurses only where BOTH sides are plain objects; otherwise a changed
// value is one atomic set at that path.
export function diffToPatch(prev: unknown, next: unknown, basePath = ""): AccountPatch {
	const patch: AccountPatch = [];

	// `next` not a plain object (primitive / array / null) → the whole node is atomic: set it if changed.
	// (Keyed on `next`, not `prev`: when prev is null/undefined but next IS an object — a first snapshot —
	// we must recurse per-key to BUILD it, not emit one root `set` at an empty path.)
	if (!isPlainObject(next)) {
		if (!deepEqual(prev, next)) patch.push({ op: "set", path: basePath, value: next ?? null });
		return patch;
	}

	// `next` is a plain object → recurse per key (treat a non-object `prev` as empty → every key is a set).
	const prevObj = isPlainObject(prev) ? prev : {};
	const nextObj = next;
	for (const key of Object.keys(nextObj)) {
		const p = prevObj[key];
		const n = nextObj[key];
		if (deepEqual(p, n)) continue;
		const path = joinPath(basePath, key);
		if (isPlainObject(p) && isPlainObject(n)) {
			patch.push(...diffToPatch(p, n, path)); // recurse into changed sub-object
		} else {
			patch.push({ op: "set", path, value: n }); // atomic set (primitive / array / new object)
		}
	}
	// Keys removed in `next` → set null (faithful "absent" for stable-keyed feature views).
	for (const key of Object.keys(prevObj)) {
		if (!(key in nextObj)) patch.push({ op: "set", path: joinPath(basePath, key), value: null });
	}
	return patch;
}
