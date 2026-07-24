// === rarities — hero rarity ladder predicates (ported from MergeCombat model/rarities.js) ===
import { C } from '../content.ts';

export const rarityMeta = (id: string) => C.HERO_RARITIES[id] || C.HERO_RARITIES.common;
export const rarityTier = (id: string) => rarityMeta(id).tier;
export const nextHeroRarity = (id: string) => {
  const i = C.HERO_RARITY_ORDER.indexOf(id);
  return i < 0 || i >= C.HERO_RARITY_ORDER.length - 1 ? null : C.HERO_RARITY_ORDER[i + 1];
};
