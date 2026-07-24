// === gacha — pull + pity (ported from MergeCombat model/gacha.js) ===
// Rarity is FIXED per hero, so a pull rolls a RARITY (banner weights, renormalised over rarities that
// have heroes in the pool), then a random hero of that rarity. Pity can FORCE a rarity. rng injected.
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';

type Banner = { id: string; limited: boolean; weights: Record<string, number>; pity: Array<{ rarity: string; max: number }>; pool: string[] };

const heroIds = () => Object.keys(C.HEROES);
const tier = (r: string) => (C.HERO_RARITIES[r] ? C.HERO_RARITIES[r].tier : 0);
const poolIds = (banner: Banner) => {
  const pool = banner.limited && banner.pool && banner.pool.length ? banner.pool.filter((id) => C.HEROES[id]) : heroIds();
  return pool.length ? pool : heroIds();
};
const rarfrom = (ids: string[]) => new Set(ids.map((id) => C.HEROES[id].rarity));

export const rollRarity = (banner: Banner, rng: Rng, forced: string | null = null): string => {
  const avail = rarfrom(poolIds(banner));
  if (forced && avail.has(forced)) return forced;
  const w = banner.weights;
  let tot = 0;
  for (const k in w) if (avail.has(k)) tot += w[k];
  if (tot <= 0) { const list = C.HERO_RARITY_ORDER.filter((k) => avail.has(k)); return list[Math.floor(rng() * list.length)] || 'common'; }
  let r = rng() * tot;
  for (const k of C.HERO_RARITY_ORDER) { if (!avail.has(k) || w[k] == null) continue; r -= w[k]; if (r < 0) return k; }
  return C.HERO_RARITY_ORDER.find((k) => avail.has(k) && w[k] != null) || 'common';
};

export const rollHeroId = (banner: Banner, rng: Rng, rarity: string): string => {
  const ids = poolIds(banner);
  const ofR = ids.filter((id) => C.HEROES[id].rarity === rarity);
  const list = ofR.length ? ofR : ids;
  return list[Math.floor(rng() * list.length)];
};

export const pull = (banner: Banner, rng: Rng, forced: string | null = null) => {
  const rarity = rollRarity(banner, rng, forced);
  const id = rollHeroId(banner, rng, rarity);
  return { id, rarity: C.HEROES[id].rarity };
};

export const initPity = (banner: Banner) => { const p: Record<string, number> = {}; for (const e of banner.pity) p[e.rarity] = 0; return p; };
export const pityForce = (banner: Banner, counters: Record<string, number>): string | null => {
  const avail = rarfrom(poolIds(banner));
  let forced: string | null = null, ft = -1;
  for (const e of banner.pity) { if (!avail.has(e.rarity)) continue; if ((counters[e.rarity] || 0) + 1 >= e.max && tier(e.rarity) > ft) { forced = e.rarity; ft = tier(e.rarity); } }
  return forced;
};
export const advancePity = (banner: Banner, counters: Record<string, number>, rolled: string) => {
  const next = { ...counters };
  for (const e of banner.pity) next[e.rarity] = tier(rolled) >= tier(e.rarity) ? 0 : (next[e.rarity] || 0) + 1;
  return next;
};
