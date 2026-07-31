// Barrel: the status table the view reads — logical (C.STATUSES) + presentation (name/colour/icon/
// description). Single source is the config registry (logical + UI); mirrors src/data/rarities.js. No logic.
import { C } from '../game/content.ts';
import { uiKey } from './_ui.js';

export const STATUSES = Object.fromEntries(Object.entries(C.STATUSES).map(([k, s]) => {
  const u = uiKey('statuses', k) || {};
  return [k, { ...s, name: u.name ?? k, color: u.color, description: u.description, asset: u.iconAssetId ?? `status.${k}` }];
}));
