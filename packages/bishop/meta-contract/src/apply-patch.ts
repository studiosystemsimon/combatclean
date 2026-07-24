import type { AccountPatch, PatchOp } from "./patch.js";

// PURE applier for AccountPatch ops. The SINGLE code path used by:
//   - the server, to derive the new blob after resolve/apply, and
//   - the client mirror, to apply the returned delta.
// One source → server & client can never drift. Never mutates the input; returns a new object.
//
// `path` is "/"-separated named keys into the blob (arrays are addressed by key, not index).
// `inc` is purely mechanical arithmetic — cap clamping happens upstream in the domain economy
// (it emits the already-clamped amount), so this stays dumb.

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Prototype-pollution guard. Patch paths are server-built today, but this is the SINGLE applier the
// client mirror also runs on server responses — so a poisoned segment here would corrupt Object.prototype
// on both sides. `__proto__/x` would walk into Object.prototype and write onto it. Reject the whole patch.
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

// Walk to the container holding the final key, creating intermediate objects on the way.
function parentOf(root: Obj, segments: string[]): { parent: Obj; key: string } {
	let node: Obj = root;
	for (let i = 0; i < segments.length - 1; i++) {
		const seg = segments[i];
		if (!isObj(node[seg])) node[seg] = {};
		node = node[seg] as Obj;
	}
	return { parent: node, key: segments[segments.length - 1] };
}

function matchesId(entry: unknown, id: string | number): boolean {
	if (entry === id) return true;
	if (isObj(entry)) return entry.iid === id || entry.id === id;
	return false;
}

function applyOp(root: Obj, op: PatchOp): void {
	const segments = op.path.split("/");
	for (const seg of segments) {
		if (FORBIDDEN_SEGMENTS.has(seg)) throw new Error(`unsafe patch path segment: ${seg}`);
	}
	const { parent, key } = parentOf(root, segments);
	switch (op.op) {
		case "set":
			parent[key] = op.value;
			break;
		case "inc": {
			const cur = typeof parent[key] === "number" ? (parent[key] as number) : 0;
			parent[key] = cur + op.amount;
			break;
		}
		case "append": {
			if (!Array.isArray(parent[key])) parent[key] = [];
			(parent[key] as unknown[]).push(op.entry);
			break;
		}
		case "remove": {
			if (Array.isArray(parent[key])) {
				parent[key] = (parent[key] as unknown[]).filter((e) => !matchesId(e, op.id));
			}
			break;
		}
	}
}

export function applyPatch<T extends object>(state: T, patch: AccountPatch): T {
	// ponytail: full deep-clone per apply is the known perf ceiling (O(blob size), not the op walk —
	// a mutation emits 1-3 ops). Fine at prototype scale + dwarfed by the Postgres round-trip. Upgrade
	// path if profiling flags it: structural sharing (immer copy-on-write) here, OR the jsonb→tall-table
	// promotion (Backend TDD ch.4) which takes the hot wallet write off the blob entirely. Not RFC-6902
	// on purpose — the mandatory `inc` op (delta-preserving) has no standard equivalent.
	const next = structuredClone(state) as Obj;
	for (const op of patch) applyOp(next, op);
	return next as T;
}
