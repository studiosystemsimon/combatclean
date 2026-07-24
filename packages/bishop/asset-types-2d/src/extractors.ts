// Runtime file extractors for the 2D formats — registered on import (no zod here, so
// this stays lightweight for the client bundle). Only the types that the convention
// walker CAN'T resolve get an explicit extractor:
//
//   • tileset — indirection: the declaration points at a `.tsx`, which points at the
//     real image. The extractor reads the `.tsx` (via ctx.readText) and returns the
//     resolved image path + parsed metadata (stashed on `derived.tileset`).
//   • frames  — folder/pattern based (frames expanded elsewhere), so no direct file.
//   • bitmap-font — indirection: the declaration points at a `.fnt`, which points at its
//     page image(s). Reads the `.fnt` and returns the resolved page path(s) + parsed
//     metadata (stashed on `derived.bitmapFont`). Mirrors the tileset extractor.
//
// sprite-animation / sprite-atlas / image / audio / automap-rule / font fall through to
// the core convention walker (their `file`/`files` keys are plain paths — a web `font`
// file is just one path, so it needs no explicit extractor).

import { registerAssetFileExtractor, resolvePosixRelative } from "@bishop/asset-registry";
import { type BitmapFontMeta, parseFntMeta } from "./fnt.js";
import { parseTsxMeta, type TilesetMeta } from "./tsx.js";

registerAssetFileExtractor("tileset", (declaration, ctx) => {
	const file = typeof declaration.file === "string" ? declaration.file : "";
	if (!file) return { files: [] };

	const xml = ctx.readText?.(ctx.basePath + file);
	if (!xml) return { files: [ctx.basePath + file] }; // no sidecar available → the tsx itself

	const parsed = parseTsxMeta(xml);
	if (!parsed || !parsed.imageSource) return { files: [] };

	const resolvedImagePath = resolvePosixRelative(ctx.basePath, file, parsed.imageSource);
	const meta: TilesetMeta = { ...parsed, resolvedImagePath };
	return { files: [resolvedImagePath], derived: { tileset: meta } };
});

registerAssetFileExtractor("frames", () => ({ files: [] }));

registerAssetFileExtractor("bitmap-font", (declaration, ctx) => {
	const file = typeof declaration.file === "string" ? declaration.file : "";
	if (!file) return { files: [] };

	const text = ctx.readText?.(ctx.basePath + file);
	if (!text) return { files: [ctx.basePath + file] }; // no sidecar available → the .fnt itself

	const parsed = parseFntMeta(text);
	if (!parsed) return { files: [ctx.basePath + file] };

	const resolvedPagePaths = parsed.pageSources.map((src) =>
		resolvePosixRelative(ctx.basePath, file, src),
	);
	const meta: BitmapFontMeta = { ...parsed, resolvedPagePaths };
	// The .fnt itself is bundled (Pixi's loader loads it), plus every page atlas.
	return { files: [ctx.basePath + file, ...resolvedPagePaths], derived: { bitmapFont: meta } };
});
