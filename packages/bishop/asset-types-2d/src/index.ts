// ─────────────────────────────────────────────────────────────────────────────
// @bishop/asset-types-2d — runtime entry. Importing this REGISTERS the 2D file
// extractors with @bishop/asset-registry (side-effect), so resolveFilePath/derived
// work for these types. Zod-free: schemas live in the "./schema" entry.
// ─────────────────────────────────────────────────────────────────────────────

import "./extractors.js";

import { type AssetRegistry, type ResolvedAsset, resolveAsset } from "@bishop/asset-registry";
import type { BitmapFontMeta } from "./fnt.js";
import type { TilesetMeta } from "./tsx.js";

export type { BitmapFontMeta } from "./fnt.js";
export type { TilesetMeta } from "./tsx.js";

// Format TS types — sourced from the zod schemas (type-only re-export, no runtime zod).
export type {
	Asset2D,
	AudioAsset,
	AutomapRuleAsset,
	BitmapFontAsset,
	FontAsset,
	FramesAsset,
	ImageAsset,
	SpriteAnimationAsset,
	SpriteAnimationClip,
	SpriteAtlasAsset,
	TilesetAsset,
} from "./schema.js";

export interface ResolvedTileset {
	asset: ResolvedAsset;
	meta: TilesetMeta;
}

/** The parsed tileset metadata an extractor stashed on `derived.tileset` (null if not a tileset). */
export function resolveTilesetMeta(asset: ResolvedAsset): TilesetMeta | null {
	const meta = asset.derived?.tileset as TilesetMeta | undefined;
	return meta ?? null;
}

/** Convenience: an asset + its tileset metadata in one lookup (null if missing/not a tileset).
 *  Follows an alias pointer to its target (via `resolveAsset`), so `assetId` may be a game name or a
 *  pack id — aliases carry no `derived`, so the tileset meta lives on the target. */
export function getResolvedTileset(
	registry: AssetRegistry,
	assetId: string,
): ResolvedTileset | null {
	const asset = resolveAsset(registry, assetId);
	if (!asset) return null;
	const meta = resolveTilesetMeta(asset);
	return meta ? { asset, meta } : null;
}

/** The parsed BMFont metadata an extractor stashed on `derived.bitmapFont` (null if not a bitmap-font). */
export function resolveBitmapFontMeta(asset: ResolvedAsset): BitmapFontMeta | null {
	const meta = asset.derived?.bitmapFont as BitmapFontMeta | undefined;
	return meta ?? null;
}
