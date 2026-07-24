// Barrel: HEROES map the view reads — logical (C.HEROES) + presentation (name + authored iconAssetId).
import { C } from '../game/content.ts';
import { uiHero } from './_ui.js';
export const HEROES = Object.fromEntries(Object.entries(C.HEROES).map(([slug, h]) => {
  const u = uiHero(slug);
  return [slug, { ...h, name: u.name ?? h.id, asset: u.iconAssetId ?? `hero.${slug}`, portrait: u.portrait }];
}));
