import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	clearAssetFormats,
	collectAssetIds,
	registerAssetFileExtractor,
	registerAssetSchema,
	requiredFilesFor,
	validateDeclaration,
	validateManifest,
} from "../src/index.js";
import {
	applyAliases,
	buildRegistryFromManifests,
	resolveAllFilePaths,
	resolveAsset,
	resolveFilePath,
} from "../src/scanner.js";
import type { AssetManifestFile, AssetRegistry, ResolvedAsset } from "../src/types.js";

function mustGet(registry: AssetRegistry, id: string): ResolvedAsset {
	const asset = registry.get(id);
	if (!asset) throw new Error(`expected asset "${id}" in registry`);
	return asset;
}

function imageManifest(declFile: string): AssetManifestFile {
	return { version: 1, assets: { pet_007: { type: "image", file: declFile } } };
}

const WIN_MANIFEST = "PetEvolutionPacks\\EvoMonster Pack 03\\assets.json";

afterEach(() => clearAssetFormats());

// ─────────────────────────────────────────────────────────────────────────────
// Cross-platform path separators (regression pins — see original bug notes).
// Resolution now runs through the convention walker (no registered extractor).
// ─────────────────────────────────────────────────────────────────────────────

describe("buildRegistryFromManifests — path separator normalization", () => {
	it("derives a forward-slash, non-empty basePath from a Windows backslash manifest path", () => {
		const registry = buildRegistryFromManifests([
			{ path: WIN_MANIFEST, data: imageManifest("ID 007/sprite.png") },
		]);
		const asset = mustGet(registry, "pet_007");
		expect(asset.basePath).toBe("PetEvolutionPacks/EvoMonster Pack 03/");
		expect(asset.basePath).not.toContain("\\");
		expect(asset.manifestPath).toBe("PetEvolutionPacks/EvoMonster Pack 03/assets.json");
	});

	it("forward-slashes the resolved file path for a backslash manifest on Windows", () => {
		const declFile = "ID 007/sprite.png";
		const registry = buildRegistryFromManifests([
			{ path: WIN_MANIFEST, data: imageManifest(declFile) },
		]);
		const resolved = resolveFilePath(mustGet(registry, "pet_007"));
		expect(resolved).toBe("PetEvolutionPacks/EvoMonster Pack 03/ID 007/sprite.png");
		expect(resolved).not.toContain("\\");
	});

	it("resolveAllFilePaths forward-slashes every path for a backslash sprite-animation manifest", () => {
		const data: AssetManifestFile = {
			version: 1,
			assets: {
				"player.archer": {
					type: "sprite-animation",
					file: "player-archer.png",
					frameWidth: 64,
					frameHeight: 64,
					clips: {
						idle: { row: 0, frames: 4, fps: 8 },
						run: { row: 1, frames: 6, fps: 12, file: "player-archer-run.png" },
					},
				},
			},
		};
		const registry = buildRegistryFromManifests([
			{ path: "PlayerPacks\\Archer\\assets.json", data },
		]);
		const paths = resolveAllFilePaths(mustGet(registry, "player.archer"));
		expect(paths).toContain("PlayerPacks/Archer/player-archer.png");
		expect(paths).toContain("PlayerPacks/Archer/player-archer-run.png");
		for (const p of paths) expect(p).not.toContain("\\");
	});

	it("resolveAllFilePaths forward-slashes every audio file for a backslash manifest", () => {
		const data: AssetManifestFile = {
			version: 1,
			assets: { "sfx.hit": { type: "audio", files: ["hit-1.wav", "hit-2.wav"] } },
		};
		const registry = buildRegistryFromManifests([{ path: "Sfx\\Combat\\assets.json", data }]);
		expect(resolveAllFilePaths(mustGet(registry, "sfx.hit"))).toEqual([
			"Sfx/Combat/hit-1.wav",
			"Sfx/Combat/hit-2.wav",
		]);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Agnostic content — opaque types, convention walking, extractor hooks.
// ─────────────────────────────────────────────────────────────────────────────

describe("format-agnostic resolution", () => {
	it("resolves an UNKNOWN type via the convention walker (file-ish keys)", () => {
		const data: AssetManifestFile = {
			version: 1,
			assets: { widget: { type: "some-future-type", file: "w.bin", meta: { count: 3 } } },
		};
		const registry = buildRegistryFromManifests([{ path: "Pack/assets.json", data }]);
		const asset = mustGet(registry, "widget");
		expect(asset.type).toBe("some-future-type");
		expect(resolveFilePath(asset)).toBe("Pack/w.bin");
	});

	it("sniffs media-extension strings even under non-file keys", () => {
		const data: AssetManifestFile = {
			version: 1,
			assets: { hero: { type: "custom", portrait: "hero.png", label: "Hero" } },
		};
		const registry = buildRegistryFromManifests([{ path: "P/assets.json", data }]);
		expect(resolveAllFilePaths(mustGet(registry, "hero"))).toEqual(["P/hero.png"]);
	});

	it("uses a registered extractor over the convention default", () => {
		registerAssetFileExtractor("blob", (decl, ctx) => ({
			files: [`${ctx.basePath}${decl.name}.blob`],
			derived: { kind: "blob" },
		}));
		const data: AssetManifestFile = {
			version: 1,
			assets: { b: { type: "blob", name: "widget", file: "ignored.png" } },
		};
		const registry = buildRegistryFromManifests([{ path: "X/assets.json", data }]);
		const asset = mustGet(registry, "b");
		expect(resolveFilePath(asset)).toBe("X/widget.blob");
		expect(asset.derived).toEqual({ kind: "blob" });
	});

	it("passes readText to extractors for indirection", () => {
		registerAssetFileExtractor("ref", (decl, ctx) => {
			const target = ctx.readText?.(ctx.basePath + decl.file);
			return { files: target ? [ctx.basePath + target] : [] };
		});
		const data: AssetManifestFile = {
			version: 1,
			assets: { r: { type: "ref", file: "pointer.txt" } },
		};
		const registry = buildRegistryFromManifests([{ path: "D/assets.json", data }], {
			readText: (p) => (p === "D/pointer.txt" ? "real.png" : undefined),
		});
		expect(resolveFilePath(mustGet(registry, "r"))).toBe("D/real.png");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Alias resolution
// ─────────────────────────────────────────────────────────────────────────────

function spriteManifest(id: string, file: string): AssetManifestFile {
	return {
		version: 1,
		assets: {
			[id]: {
				type: "sprite-animation",
				file,
				frameWidth: 64,
				frameHeight: 64,
				clips: { idle: { row: 0, frames: 4, fps: 8 } },
			},
		},
	};
}

describe("applyAliases", () => {
	it("creates an alias POINTER that resolveAsset follows to the target (never a copy)", () => {
		const registry = buildRegistryFromManifests([
			{ path: "Characters/assets.json", data: spriteManifest("real.archer", "archer.png") },
		]);
		const { applied, warnings } = applyAliases(registry, { "player.archer": "real.archer" });
		expect(applied).toBe(1);
		expect(warnings).toHaveLength(0);
		const alias = mustGet(registry, "player.archer");
		const real = mustGet(registry, "real.archer");
		expect(alias.aliasOf).toBe("real.archer");
		expect(alias.files).toEqual([]); // pointer carries no content — resolveAsset redirects
		// resolveAsset follows the pointer to the real target; resolution reflects whatever the target IS
		expect(resolveAsset(registry, "player.archer")).toBe(real);
		expect(resolveFilePath(real)).toBe("Characters/archer.png");
	});

	it("resolveAsset follows a pointer, returns itself for a real asset, undefined when broken", () => {
		const registry = buildRegistryFromManifests([
			{ path: "Characters/assets.json", data: spriteManifest("real.archer", "archer.png") },
		]);
		applyAliases(registry, { "player.archer": "real.archer" });
		expect(resolveAsset(registry, "real.archer")?.id).toBe("real.archer"); // real → itself
		expect(resolveAsset(registry, "player.archer")?.id).toBe("real.archer"); // alias → target
		expect(resolveAsset(registry, "nope")).toBeUndefined(); // unknown id
		registry.delete("real.archer");
		expect(resolveAsset(registry, "player.archer")).toBeUndefined(); // broken alias
	});

	it("skips an alias that conflicts with a real asset", () => {
		const registry = buildRegistryFromManifests([
			{
				path: "assets.json",
				data: {
					version: 1,
					assets: {
						"real.a": { type: "image", file: "a.png" },
						"real.b": { type: "image", file: "b.png" },
					},
				},
			},
		]);
		const { applied, warnings } = applyAliases(registry, { "real.a": "real.b" });
		expect(applied).toBe(0);
		expect(warnings[0]).toContain("conflicts with real asset");
	});

	it("skips an alias targeting an unknown asset", () => {
		const registry = buildRegistryFromManifests([
			{ path: "assets.json", data: spriteManifest("real.archer", "archer.png") },
		]);
		const { applied, warnings } = applyAliases(registry, { "player.archer": "nonexistent" });
		expect(applied).toBe(0);
		expect(warnings[0]).toContain("targets unknown asset");
		expect(registry.has("player.archer")).toBe(false);
	});

	it("prevents alias chains (alias targeting another alias)", () => {
		const registry = buildRegistryFromManifests([
			{ path: "assets.json", data: spriteManifest("real.archer", "archer.png") },
		]);
		applyAliases(registry, { "alias.a": "real.archer" });
		const { applied, warnings } = applyAliases(registry, { "alias.b": "alias.a" });
		expect(applied).toBe(0);
		expect(warnings[0]).toContain("chains not allowed");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation (zod, via registered schemas)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateDeclaration / validateManifest", () => {
	it("reports an unregistered type", () => {
		const errors = validateDeclaration("x", { type: "mystery" });
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("no schema registered");
	});

	it("passes a valid declaration and fails an invalid one against its schema", () => {
		registerAssetSchema("thing", z.object({ type: z.literal("thing"), size: z.number() }));
		expect(validateDeclaration("ok", { type: "thing", size: 5 })).toHaveLength(0);
		const bad = validateDeclaration("bad", { type: "thing", size: "big" });
		expect(bad).toHaveLength(1);
		expect(bad[0].assetId).toBe("bad");
	});

	it("validateManifest flags a bad version and each bad asset", () => {
		registerAssetSchema("thing", z.object({ type: z.literal("thing"), size: z.number() }));
		const errors = validateManifest({
			version: 2,
			assets: { good: { type: "thing", size: 1 }, bad: { type: "thing" } },
		});
		expect(errors.some((e) => e.message.includes("version must be 1"))).toBe(true);
		expect(errors.some((e) => e.assetId === "bad")).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Build-time trim (*AssetId collection)
// ─────────────────────────────────────────────────────────────────────────────

describe("collectAssetIds / requiredFilesFor", () => {
	it("collects every *AssetId string, ignoring other fields", () => {
		const config = {
			id: 202,
			iconAssetId: "ui.icon",
			nested: { spriteAssetId: "unit.sheep", notAnId: "skip" },
			list: [{ tilesetAssetId: "terrain.grass" }, { assetId: "" }],
		};
		const ids = [...collectAssetIds(config)];
		expect(ids.sort()).toEqual(["terrain.grass", "ui.icon", "unit.sheep"]);
	});

	it("maps a set of ids to their deduped required files", () => {
		const registry = buildRegistryFromManifests([
			{ path: "Characters/assets.json", data: spriteManifest("real.archer", "archer.png") },
		]);
		applyAliases(registry, { "player.archer": "real.archer" });
		const files = requiredFilesFor(registry, ["player.archer", "missing"]);
		expect(files).toEqual(["Characters/archer.png"]);
	});
});
