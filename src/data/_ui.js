// View-side presentation lookup — resolves a content slug/key to its UI-registry entry (name/colour/
// theme), keyed by the SAME id/key as the logical entry. Single source: the baked registries via
// content C (C.ui = the UI registry; the slug→id maps bridge id-kind categories). No data is copied —
// the data barrels re-combine logical (C) + presentation (C.ui) into the shape the ported view reads.
import { C } from '../game/content.ts';

// Returns PRESENTATION ONLY. The UI entry's `id` (numeric, id-kind) / `key` (string, key-kind) are
// the registry IDENTITY LINK used to find it — NOT presentation. They must be stripped here so a
// barrel that spreads the result (`{ ...logical, ...uiEntry }`) can never let the UI's numeric `id`
// clobber the logical slug `id` the runtime keys on (bug: gacha `banner.id` became 6000 → the summon
// reducer's `C.BANNERS[6000]` missed → silent no-op). Barrels merge presentation; identity stays logical.
const at = (cat, key) => {
  const e = (C.ui && C.ui[cat] && C.ui[cat][String(key)]) || {};
  const { id: _id, key: _key, ...presentation } = e;
  return presentation;
};

export const uiHero = (slug) => at('heroes', C.heroSlugToId[slug]);
export const uiEnemy = (slug) => at('enemies', C.enemySlugToId[slug]);
export const uiPiece = (slug) => at('gearPieces', C.pieceSlugToId[slug]);
export const uiZone = (slug) => at('zones', C.zoneSlugToId[slug]);
export const uiBanner = (slug) => at('banners', C.bannerSlugToId[slug]);
export const uiKey = (cat, key) => at(cat, key); // key-kind: rarities / gearRarities / gearSlots / generators / chains
