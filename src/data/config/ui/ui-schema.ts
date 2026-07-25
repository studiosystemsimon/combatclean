// === UI-config schema — the presentation registry (SSOT of the ui-config shape) ===
//
// The THIRD leg of the id-contract: per-entity PRESENTATION keyed by the SAME id (id-kind) or key
// (key-kind) as the logical entry — localized name/description, UI colour, icon/splash asset ids, and
// category-specific presentation (ability names, gear power text, zone biome tint, banner theme, emoji
// fallback). ALL human/UI text + colour lives here; the logical config holds NONE of it. Every field
// is presentation-only (never logic) — named + optional + strict, so it stays verifiable (no open bag).
// UI colour is a CSS/hex string (distinct from the VSM's linear tuples). Icons are asset-registry ids.
import { z } from 'zod';

export const zUIConfig = z
  .object({
    id: z.number().int().optional().describe('The logical id this presentation belongs to (id-kind).'),
    key: z.string().optional().describe('The logical key this presentation belongs to (key-kind).'),
    name: z.string().describe('Localized display name shown to the player.'),
    description: z.string().optional().describe('Localized description / flavour / sub-line.'),
    color: z.string().optional().describe('UI accent colour (CSS/hex string).'),
    emoji: z.string().optional().describe('Emoji fallback shown when the icon asset is unavailable.'),
    iconAssetId: z.string().optional().describe('Asset-registry id for the icon (never a path).'),
    splashAssetId: z.string().optional().describe('Asset-registry id for a large splash image.'),
    // ── category-specific presentation (all optional, presentation-only) ──
    abilityNames: z.object({
      basic: z.string().optional(), normal: z.string().optional(), limit: z.string().optional(),
    }).strict().optional().describe('heroes: display names for the basic/normal/limit abilities.'),
    power: z.string().optional().describe('gear uniques: the special-effect flavour text (display-only).'),
    biome: z.object({
      from: z.string(), to: z.string(), accent: z.string(),
    }).strict().optional().describe('zones: biome colour tint (backdrop gradient + accent).'),
    theme: z.string().optional().describe('banners: primary theme colour.'),
    theme2: z.string().optional().describe('banners: secondary theme colour.'),
    portrait: z.object({
      scale: z.number().optional(), x: z.number().optional(), y: z.number().optional(),
    }).strict().optional().describe('heroes: portrait framing in the hero tile — scale multiplier + normalized x/y offset (fraction of the tile). Authored by the char-art trim tool.'),
    combat: z.object({
      scale: z.number().optional(),
    }).strict().optional().describe('enemies: in-combat chip scale multiplier. Position is the asset anchor (registration point), not here. Authored by the char-art trim tool.'),
  })
  .strict()
  .refine((e) => e.id !== undefined || e.key !== undefined, {
    message: 'a UI entry must carry either an "id" (id-kind) or a "key" (key-kind) matching its logical entry',
  });

export type UIConfig = z.infer<typeof zUIConfig>;
