import { describe, expect, it } from "vitest";
import { zAccountPatch, zPatchOp } from "../src/patch.js";

describe("zPatchOp", () => {
	it("accepts each op kind", () => {
		expect(zPatchOp.parse({ op: "set", path: "profile/tutorialStep", value: 4 })).toBeTruthy();
		expect(zPatchOp.parse({ op: "inc", path: "resources/5000", amount: 500 })).toBeTruthy();
		expect(zPatchOp.parse({ op: "append", path: "items", entry: { iid: "x" } })).toBeTruthy();
		expect(zPatchOp.parse({ op: "remove", path: "unlocks", id: 8001 })).toBeTruthy();
	});

	it("rejects an unknown op", () => {
		expect(() => zPatchOp.parse({ op: "delete", path: "x" })).toThrow();
	});

	it("rejects inc without a numeric amount", () => {
		expect(() => zPatchOp.parse({ op: "inc", path: "resources/5000", amount: "500" })).toThrow();
	});

	it("parses a full patch array", () => {
		const patch = zAccountPatch.parse([
			{ op: "inc", path: "resources/5000", amount: 500 },
			{ op: "set", path: "features/battlepass/claimedFree", value: 6 },
		]);
		expect(patch).toHaveLength(2);
	});
});
