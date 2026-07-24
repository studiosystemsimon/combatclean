// View-side presentation lookup — resolves a content slug/key to its UI-registry entry (name/colour/
// theme), keyed by the SAME id/key as the logical entry. Single source: the baked registries via
// content C (C.ui = the UI registry; the slug→id maps bridge id-kind categories). No data is copied —
// the data barrels re-combine logical (C) + presentation (C.ui) into the shape the ported view reads.
import { C } from '../game/content.ts';

const at = (cat, key) => (C.ui && C.ui[cat] && C.ui[cat][String(key)]) || {};

export const uiHero = (slug) => at('heroes', C.heroSlugToId[slug]);
export const uiEnemy = (slug) => at('enemies', C.enemySlugToId[slug]);
export const uiPiece = (slug) => at('gearPieces', C.pieceSlugToId[slug]);
export const uiZone = (slug) => at('zones', C.zoneSlugToId[slug]);
export const uiBanner = (slug) => at('banners', C.bannerSlugToId[slug]);
export const uiKey = (cat, key) => at(cat, key); // key-kind: rarities / gearRarities / gearSlots / generators / chains
