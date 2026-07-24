// Barrel: generator tiles the view reads — logical (C.GENERATORS) + presentation (name + iconAssetId).
import { C } from '../game/content.ts';
import { uiKey } from './_ui.js';
export const GENERATORS = Object.fromEntries(Object.entries(C.GENERATORS).map(([k, g]) => {
  const u = uiKey('generators', k);
  return [k, { ...g, name: u.name ?? k, asset: u.iconAssetId ?? `gen.${k}` }];
}));
