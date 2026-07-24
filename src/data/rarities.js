// Barrel: hero rarity ladder the view reads — logical (C.HERO_RARITIES) + presentation (colour/theme) re-combined.
import { C } from '../game/content.ts';
import { uiKey } from './_ui.js';
export const HERO_RARITY_ORDER = C.HERO_RARITY_ORDER;
export const HERO_RARITIES = Object.fromEntries(C.HERO_RARITY_ORDER.map((k) => {
  const u = uiKey('rarities', k);
  return [k, { ...C.HERO_RARITIES[k], name: u.name ?? k, ...u }];
}));
