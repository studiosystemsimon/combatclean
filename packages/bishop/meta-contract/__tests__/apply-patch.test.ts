import { describe, expect, it } from "vitest";
import { applyPatch } from "../src/apply-patch.js";
import type { AccountBlob } from "../src/account.js";

function blob(): AccountBlob {
	return {
		schemaVersion: 7,
		resources: { "5000": 1240, "5001": 30 },
		unlocks: [8001, 8042],
		items: [{ iid: "a", configId: 7003, stats: { lvl: 3 } }],
		profile: {},
		features: {},
		_server: {},
	};
}

describe("applyPatch", () => {
	it("inc adds to an existing numeric wallet entry", () => {
		const next = applyPatch(blob(), [{ op: "inc", path: "resources/5000", amount: 500 }]);
		expect(next.resources["5000"]).toBe(1740);
	});

	it("inc treats a missing key as 0", () => {
		const next = applyPatch(blob(), [{ op: "inc", path: "resources/5999", amount: 10 }]);
		expect(next.resources["5999"]).toBe(10);
	});

	it("set writes a nested value, creating intermediates", () => {
		const next = applyPatch(blob(), [
			{ op: "set", path: "features/battlepass/claimedFree", value: 6 },
		]);
		expect((next.features.battlepass as { claimedFree: number }).claimedFree).toBe(6);
	});

	it("append pushes onto a list", () => {
		const next = applyPatch(blob(), [{ op: "append", path: "unlocks", entry: 9110 }]);
		expect(next.unlocks).toEqual([8001, 8042, 9110]);
	});

	it("remove drops a primitive by value", () => {
		const next = applyPatch(blob(), [{ op: "remove", path: "unlocks", id: 8042 }]);
		expect(next.unlocks).toEqual([8001]);
	});

	it("remove drops an object by iid", () => {
		const next = applyPatch(blob(), [{ op: "remove", path: "items", id: "a" }]);
		expect(next.items).toEqual([]);
	});

	it("does not mutate the input", () => {
		const before = blob();
		applyPatch(before, [{ op: "inc", path: "resources/5000", amount: 500 }]);
		expect(before.resources["5000"]).toBe(1240);
	});

	it("rejects prototype-polluting path segments (defense-in-depth)", () => {
		for (const path of ["__proto__/polluted", "constructor/prototype/x", "features/prototype/y"]) {
			expect(() => applyPatch(blob(), [{ op: "set", path, value: true }])).toThrow(/unsafe/);
		}
		// and Object.prototype stays clean
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
});
