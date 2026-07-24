// Barrel: gear tables the view reads — logical (C.GEAR_*) + presentation (UI registry: name/colour/icon).
import { C } from '../game/content.ts';
import { uiPiece, uiKey } from './_ui.js';
export const GEAR_FUSE = C.GEAR_FUSE;
export const GEAR_SLOTS = C.GEAR_SLOTS;
export const GEAR_RARITY_ORDER = C.GEAR_RARITY_ORDER;
export const GEAR_RARITY = Object.fromEntries(C.GEAR_RARITY_ORDER.map((k) => {
  const u = uiKey('gearRarities', k);
  return [k, { ...C.GEAR_RARITY[k], name: u.name ?? k, ...u }];
}));
export const GEAR_SLOT_META = Object.fromEntries(C.GEAR_SLOTS.map((s) => {
  const u = uiKey('gearSlots', s);
  return [s, { name: u.name ?? s, asset: u.iconAssetId ?? `gear.${s}` }];
}));
export const GEAR_PIECES = Object.fromEntries(Object.entries(C.GEAR_PIECES).map(([slug, p]) => {
  const u = uiPiece(slug);
  return [slug, { ...p, name: u.name ?? p.name, asset: u.iconAssetId ?? `piece.${slug}` }];
}));
