import { describe, expect, it } from "vitest";
import { applyPatch } from "../src/apply-patch.js";
import { deepEqual, diffToPatch } from "../src/diff.js";

// diffToPatch → the delta an own-table feature (the run) sends to sync its document to the client mirror.
// The round-trip invariant is the contract: applyPatch(prev, diffToPatch(prev, next)) deep-equals next.

const roundTrips = (prev: unknown, next: unknown) =>
	expect(applyPatch((prev ?? {}) as object, diffToPatch(prev, next))).toEqual(next);

describe("diffToPatch", () => {
	it("builds the whole document from a null prev (first snapshot — no root-set corruption)", () => {
		const next = { runToken: "t", player: { hp: 80, boons: [] }, map: { nodes: [1, 2] } };
		const patch = diffToPatch(null, next);
		// per-KEY sets (not one `set` at an empty path) — the bug this locks
		expect(patch.every((op) => op.path !== "")).toBe(true);
		roundTrips(null, next);
	});

	it("emits only changed subtrees on an update", () => {
		const prev = { player: { hp: 80, level: 1 }, threat: 0 };
		const next = { player: { hp: 55, level: 1 }, threat: 0 };
		const patch = diffToPatch(prev, next);
		expect(patch).toEqual([{ op: "set", path: "player/hp", value: 55 }]);
		roundTrips(prev, next);
	});

	it("treats arrays atomically (whole-array set when changed)", () => {
		const prev = { boons: [{ id: "a" }] };
		const next = { boons: [{ id: "a" }, { id: "b" }] };
		expect(diffToPatch(prev, next)).toEqual([
			{ op: "set", path: "boons", value: [{ id: "a" }, { id: "b" }] },
		]);
		roundTrips(prev, next);
	});

	it("sets a removed key to null (stable-keyed feature views)", () => {
		const prev = { activeNode: { index: 1 }, x: 1 };
		const next = { x: 1 };
		expect(diffToPatch(prev, next)).toEqual([{ op: "set", path: "activeNode", value: null }]);
	});

	it("no-op when unchanged", () => {
		expect(diffToPatch({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
	});

	it("deepEqual handles nested arrays/objects", () => {
		expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
		expect(deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
	});
});
