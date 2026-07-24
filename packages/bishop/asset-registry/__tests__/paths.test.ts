import { describe, expect, it } from "vitest";
import { resolvePosixRelative } from "../src/paths.js";

describe("resolvePosixRelative", () => {
	it("resolves a file-local sidecar against the manifest basePath + file dir", () => {
		expect(resolvePosixRelative("", "equipment/adventurer/bow.gltf", "bow.bin")).toBe(
			"equipment/adventurer/bow.bin",
		);
		expect(resolvePosixRelative("", "equipment/adventurer/bow.gltf", "../shared/tex.png")).toBe(
			"equipment/shared/tex.png",
		);
	});

	it("prefixes and normalizes against a non-empty basePath", () => {
		expect(resolvePosixRelative("packs/ruins/", "tilesets/wall.tsx", "../images/wall.png")).toBe(
			"packs/ruins/images/wall.png",
		);
	});
});
