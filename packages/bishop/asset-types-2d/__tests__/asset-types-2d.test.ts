import {
	type AssetManifestFile,
	applyAliases,
	buildRegistryFromManifests,
	resolveAllFilePaths,
	resolveAsset,
	resolveFilePath,
	validateDeclaration,
} from "@bishop/asset-registry";
import { describe, expect, it } from "vitest";
// Side-effect registration: extractors (runtime) + schemas (validation).
import "../src/index.js";
import "../src/schema.js";
import { parseFntMeta } from "../src/fnt.js";
import { getResolvedTileset, resolveBitmapFontMeta, resolveTilesetMeta } from "../src/index.js";

const WALL_TSX =
	'<tileset tilewidth="32" tileheight="32" columns="4" tilecount="16"><image source="../../Tilesets/wall.png"/></tileset>';

function tilesetRegistry() {
	const data: AssetManifestFile = {
		version: 1,
		assets: { "tileset.wall": { type: "tileset", file: "TiledMap Editor/Tilesets/wall.tsx" } },
	};
	return buildRegistryFromManifests([{ path: "TilePacks\\AncientRuins\\assets.json", data }], {
		readText: (p) =>
			p === "TilePacks/AncientRuins/TiledMap Editor/Tilesets/wall.tsx" ? WALL_TSX : undefined,
	});
}

describe("tileset extractor", () => {
	it("resolves the TSX-relative image to a forward-slash path and exposes meta", () => {
		const registry = tilesetRegistry();
		expect(resolveFilePath(registry.get("tileset.wall")!)).toBe(
			"TilePacks/AncientRuins/Tilesets/wall.png",
		);
		const meta = resolveTilesetMeta(registry.get("tileset.wall")!);
		expect(meta?.tileWidth).toBe(32);
		expect(meta?.columns).toBe(4);
		expect(meta?.resolvedImagePath).toBe("TilePacks/AncientRuins/Tilesets/wall.png");
	});

	it("tileset meta survives an alias (pure pointer, followed at read time)", () => {
		const registry = tilesetRegistry();
		applyAliases(registry, { "terrain.wall": "tileset.wall" });

		// The alias entry is a pointer only — aliasOf set, no files/derived of its own.
		const alias = registry.get("terrain.wall");
		expect(alias?.aliasOf).toBe("tileset.wall");
		expect(alias?.files).toEqual([]);

		// resolveAsset follows the pointer to the target, where files + tileset meta live.
		const target = resolveAsset(registry, "terrain.wall");
		expect(target?.id).toBe("tileset.wall");
		expect(resolveTilesetMeta(target!)?.resolvedImagePath).toBe(
			"TilePacks/AncientRuins/Tilesets/wall.png",
		);
		expect(resolveFilePath(target!)).toBe(resolveFilePath(registry.get("tileset.wall")!));

		// The by-id convenience helper follows the alias too (aliases supported everywhere).
		const viaAlias = getResolvedTileset(registry, "terrain.wall");
		expect(viaAlias?.asset.id).toBe("tileset.wall");
		expect(viaAlias?.meta.resolvedImagePath).toBe("TilePacks/AncientRuins/Tilesets/wall.png");
	});
});

describe("2D schemas", () => {
	it("accepts a valid sprite-animation and rejects an invalid one", () => {
		expect(
			validateDeclaration("s", {
				type: "sprite-animation",
				frameWidth: 64,
				frameHeight: 64,
				clips: { idle: { row: 0, frames: 4, fps: 8 } },
			}),
		).toHaveLength(0);
		expect(
			validateDeclaration("s", {
				type: "sprite-animation",
				frameWidth: "wide",
				frameHeight: 64,
				clips: {},
			}).length,
		).toBeGreaterThan(0);
	});

	it("accepts image/audio/tileset and rejects a bad audio", () => {
		expect(validateDeclaration("i", { type: "image", file: "a.png" })).toHaveLength(0);
		expect(validateDeclaration("a", { type: "audio", files: ["a.wav"] })).toHaveLength(0);
		expect(validateDeclaration("t", { type: "tileset", file: "a.tsx" })).toHaveLength(0);
		expect(validateDeclaration("a", { type: "audio", files: "not-array" }).length).toBeGreaterThan(
			0,
		);
	});

	it("accepts font/bitmap-font and rejects a font missing family", () => {
		expect(
			validateDeclaration("f", { type: "font", file: "x.ttf", family: "Luckiest Guy" }),
		).toHaveLength(0);
		expect(validateDeclaration("b", { type: "bitmap-font", file: "x.fnt" })).toHaveLength(0);
		expect(validateDeclaration("f", { type: "font", file: "x.ttf" }).length).toBeGreaterThan(0);
	});
});

describe("font extractors", () => {
	it("web font resolves its file via the convention walker (extension-independent)", () => {
		const data: AssetManifestFile = {
			version: 1,
			assets: {
				"font.display": { type: "font", file: "LuckiestGuy-Regular.ttf", family: "Luckiest Guy" },
			},
		};
		const registry = buildRegistryFromManifests([{ path: "fonts/assets.json", data }]);
		expect(resolveFilePath(registry.get("font.display")!)).toBe("fonts/LuckiestGuy-Regular.ttf");
	});

	it("bitmap-font resolves the .fnt + its page atlas and exposes meta (MSDF flagged)", () => {
		const FNT =
			'info face="Hero" size=48\ncommon lineHeight=48 pages=1\npage id=0 file="hero.png"\ndistanceField fieldType=msdf distanceRange=4';
		const data: AssetManifestFile = {
			version: 1,
			assets: { "font.hero": { type: "bitmap-font", file: "hero.fnt" } },
		};
		const registry = buildRegistryFromManifests([{ path: "fonts/assets.json", data }], {
			readText: (p) => (p === "fonts/hero.fnt" ? FNT : undefined),
		});
		expect(resolveAllFilePaths(registry.get("font.hero")!)).toEqual([
			"fonts/hero.fnt",
			"fonts/hero.png",
		]);
		const meta = resolveBitmapFontMeta(registry.get("font.hero")!);
		expect(meta?.face).toBe("Hero");
		expect(meta?.distanceField).toBe(true);
		expect(meta?.resolvedPagePaths).toEqual(["fonts/hero.png"]);
	});
});

describe("fnt parser", () => {
	it("parses text-format page + face, and detects distanceField", () => {
		const meta = parseFntMeta('info face="Arcade"\npage id=0 file="atlas.png"');
		expect(meta?.face).toBe("Arcade");
		expect(meta?.pageSources).toEqual(["atlas.png"]);
		expect(meta?.distanceField).toBe(false);
	});

	it("parses XML-format multi-page descriptors", () => {
		const meta = parseFntMeta(
			'<font><info face="X"/><pages><page id="0" file="a.png"/><page id="1" file="b.png"/></pages></font>',
		);
		expect(meta?.pageSources).toEqual(["a.png", "b.png"]);
	});

	it("returns null for a non-BMFont string", () => {
		expect(parseFntMeta("not a font descriptor")).toBeNull();
	});
});
