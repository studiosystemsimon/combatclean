// Barrel: gacha banners the view reads — logical (C.BANNERS) + presentation (name/theme) re-combined.
import { C } from '../game/content.ts';
import { uiBanner } from './_ui.js';
export const BANNER_ORDER = C.BANNER_ORDER;
export const BANNERS = Object.fromEntries(Object.entries(C.BANNERS).map(([slug, b]) => {
  const u = uiBanner(slug);
  return [slug, { ...b, name: u.name ?? b.id, ...u }];
}));
