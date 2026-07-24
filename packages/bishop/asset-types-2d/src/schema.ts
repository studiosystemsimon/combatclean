// zod schemas for the 2D asset formats — the SINGLE source of truth for both
// validation and the TypeScript types (via z.infer). Importing this module registers
// every schema with the core (registerAssetSchema), so it's a BUILD/AUTHORING entry:
// the CLI and the vite plugin import it; the client bundle never does.

import { registerAssetSchema } from "@bishop/asset-registry";
import { z } from "zod";

const zAnchor = z.object({ x: z.number(), y: z.number() });

export const zSpriteAnimationClip = z.object({
	row: z.number().describe("Row of this clip within the sheet."),
	frames: z.number().describe("Frame count in this clip."),
	fps: z.number().describe("Playback speed."),
	startCol: z
		.number()
		.optional()
		.describe("First column of this clip within its row (for >1 clip packed on a single row)."),
	file: z.string().optional().describe("Separate spritesheet for this clip (optional)."),
});
export type SpriteAnimationClip = z.infer<typeof zSpriteAnimationClip>;

export const zSpriteAnimationAsset = z.object({
	type: z.literal("sprite-animation"),
	file: z.string().optional().describe("Main spritesheet (optional if every clip has its own)."),
	frameWidth: z.number(),
	frameHeight: z.number(),
	columns: z.number().optional(),
	rows: z.number().optional(),
	clips: z.record(z.string(), zSpriteAnimationClip),
	anchor: zAnchor.default({ x: 0.5, y: 0.5 }),
});
export type SpriteAnimationAsset = z.infer<typeof zSpriteAnimationAsset>;

export const zSpriteAtlasAsset = z.object({
	type: z.literal("sprite-atlas"),
	file: z.string(),
	frameWidth: z.number(),
	frameHeight: z.number(),
	columns: z.number().optional(),
	rows: z.number().optional(),
	sprites: z.record(z.string(), z.object({ col: z.number(), row: z.number() })).optional(),
	anchor: zAnchor.optional(),
});
export type SpriteAtlasAsset = z.infer<typeof zSpriteAtlasAsset>;

export const zFramesAsset = z.object({
	type: z.literal("frames"),
	folder: z.string().optional(),
	pattern: z.string().optional(),
	fps: z.number(),
	frameWidth: z.number().optional(),
	frameHeight: z.number().optional(),
	frameCount: z.number().optional(),
	anchor: zAnchor.optional(),
});
export type FramesAsset = z.infer<typeof zFramesAsset>;

export const zImageAsset = z.object({
	type: z.literal("image"),
	file: z.string(),
	anchor: zAnchor.optional(),
});
export type ImageAsset = z.infer<typeof zImageAsset>;

export const zTilesetAsset = z.object({
	type: z.literal("tileset"),
	file: z.string().describe("Path to the `.tsx` (Tiled tileset) file."),
});
export type TilesetAsset = z.infer<typeof zTilesetAsset>;

export const zAutomapRuleAsset = z.object({
	type: z.literal("automap-rule"),
	file: z.string().describe("Path to the `.tmx` rule file."),
});
export type AutomapRuleAsset = z.infer<typeof zAutomapRuleAsset>;

export const zAudioAsset = z.object({
	type: z.literal("audio"),
	files: z.array(z.string()),
});
export type AudioAsset = z.infer<typeof zAudioAsset>;

export const zFontAsset = z.object({
	type: z.literal("font"),
	file: z.string().describe("Web font file (.ttf/.otf/.woff/.woff2)."),
	family: z.string().describe("font-family name to register under (CSS @font-face + Pixi)."),
	weight: z.union([z.number(), z.string()]).optional().describe("Optional font-weight."),
	style: z.enum(["normal", "italic"]).optional(),
});
export type FontAsset = z.infer<typeof zFontAsset>;

export const zBitmapFontAsset = z.object({
	type: z.literal("bitmap-font"),
	file: z
		.string()
		.describe("AngelCode BMFont descriptor (.fnt/.xml). May be MSDF/SDF (distanceField section)."),
	family: z.string().optional().describe("Override the family named in the .fnt."),
});
export type BitmapFontAsset = z.infer<typeof zBitmapFontAsset>;

/** Discriminated union of every 2D format. */
export const zAsset2D = z.discriminatedUnion("type", [
	zSpriteAnimationAsset,
	zSpriteAtlasAsset,
	zFramesAsset,
	zImageAsset,
	zTilesetAsset,
	zAutomapRuleAsset,
	zAudioAsset,
	zFontAsset,
	zBitmapFontAsset,
]);
export type Asset2D = z.infer<typeof zAsset2D>;

registerAssetSchema("sprite-animation", zSpriteAnimationAsset);
registerAssetSchema("sprite-atlas", zSpriteAtlasAsset);
registerAssetSchema("frames", zFramesAsset);
registerAssetSchema("image", zImageAsset);
registerAssetSchema("tileset", zTilesetAsset);
registerAssetSchema("automap-rule", zAutomapRuleAsset);
registerAssetSchema("audio", zAudioAsset);
registerAssetSchema("font", zFontAsset);
registerAssetSchema("bitmap-font", zBitmapFontAsset);
