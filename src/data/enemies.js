// Barrel: enemy table + level-scaling the view reads — logical (C) + presentation (name + iconAssetId).
import { C } from '../game/content.ts';
import { uiEnemy } from './_ui.js';
export const LEVEL_SCALING = C.LEVEL_SCALING;
export const ENEMY_BY_ID = Object.fromEntries(Object.entries(C.ENEMY_BY_ID).map(([slug, e]) => {
  const u = uiEnemy(slug);
  return [slug, { ...e, name: u.name ?? e.id, asset: u.iconAssetId ?? `enemy.${slug}` }];
}));
