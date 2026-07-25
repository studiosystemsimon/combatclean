// Barrel: HEROES map the view reads — logical (C.HEROES) + presentation (name + authored iconAssetId).
import { C } from '../game/content.ts';
import { uiHero } from './_ui.js';
export const HEROES = Object.fromEntries(Object.entries(C.HEROES).map(([slug, h]) => {
  const u = uiHero(slug);
  // combatScale = the in-combat AVATAR size (UI-config `combat.scale`, authored in the trim tool);
  // position is the asset anchor (reg point). DISTINCT from `portrait` (the hero-TILE framing). Default 1.
  return [slug, { ...h, name: u.name ?? h.id, asset: u.iconAssetId ?? `hero.${slug}`, portrait: u.portrait, combatScale: (u.combat && u.combat.scale) || 1 }];
}));
