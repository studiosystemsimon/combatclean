// Barrel: enemy table + level-scaling the view reads — logical (C) + presentation (name + iconAssetId).
import { C } from '../game/content.ts';
import { uiEnemy } from './_ui.js';
export const LEVEL_SCALING = C.LEVEL_SCALING;
export const ENEMY_BY_ID = Object.fromEntries(Object.entries(C.ENEMY_BY_ID).map(([slug, e]) => {
  const u = uiEnemy(slug);
  // combatScale = the in-combat chip size multiplier authored by the char-art trim tool (UI-config
  // `combat.scale`). Position is the asset anchor (registration point); this is the SIZE. Default 1.
  return [slug, { ...e, name: u.name ?? e.id, asset: u.iconAssetId ?? `enemy.${slug}`, combatScale: (u.combat && u.combat.scale) || 1 }];
}));
