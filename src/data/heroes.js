// Barrel: HEROES = the resolved HeroClass read-model the view reads — the ONE cohesive structure per
// hero-class, combining logical (C.HEROES: stats/abilities/rarity/chain/classKey + the resolved
// `slots` loadout) + presentation (name + asset + framings). Authored across the three registries;
// resolved here so the view references one structure, not three scattered lookups.
import { C } from '../game/content.ts';
import { uiHero } from './_ui.js';
export const HEROES = Object.fromEntries(Object.entries(C.HEROES).map(([slug, h]) => {
  const u = uiHero(slug);
  // combatScale = the in-combat AVATAR size (UI-config `combat.scale`, authored in the trim tool);
  // position is the asset anchor (reg point). DISTINCT from `portrait` (the hero-TILE framing). Default 1.
  // `slots` resolves the class's loadout (its own, else the shared default) so the class carries it directly.
  return [slug, { ...h, name: u.name ?? h.id, asset: u.iconAssetId ?? `hero.${slug}`, portrait: u.portrait, combatScale: (u.combat && u.combat.scale) || 1, slots: h.slots || C.GEAR_LOADOUT.defaultSlots }];
}));
