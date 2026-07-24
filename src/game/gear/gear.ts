// === gear — power/equip/level/fuse (ported from MergeCombat model/gear.js) ===
// Gear items { id, pieceId, slot, rarity, level, base, equippedTo }. Power feeds hero stats. Pure;
// rng injected, ids from the caller. Reads content C (GEAR_* tables).
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';
import type { GearItem } from '../types.ts';

type GearMap = Record<string, GearItem>;

export const pieceDef = (g: GearItem) => (g && C.GEAR_PIECES[g.pieceId]) || null;
export const pieceName = (g: GearItem) => { const d = pieceDef(g); return d ? d.name : null; };
export const pieceMaxRarity = (g: GearItem) => { const d = pieceDef(g); return d ? d.maxRarity : C.GEAR_RARITY_ORDER[C.GEAR_RARITY_ORDER.length - 1]; };

export const gearPower = (g: GearItem) => Math.round(g.base * C.GEAR_RARITY[g.rarity].mul * (1 + C.GEAR_LEVEL.powerPerLevel * (g.level - 1)));
export const gearLevelCost = (level: number) => Math.round(C.GEAR_LEVEL.xpBase * Math.pow(C.GEAR_LEVEL.xpGrowth, level - 1));
export const gearAtMax = (g: GearItem) => g.level >= C.GEAR_LEVEL.maxLevel;
export const equippedFor = (gearMap: GearMap, heroId: string) => Object.values(gearMap).filter((g) => g.equippedTo === heroId);
export const heroGearPower = (gearMap: GearMap, heroId: string) => equippedFor(gearMap, heroId).reduce((s, g) => s + gearPower(g), 0);

const randInt = (a: number, b: number, rng: Rng) => a + Math.floor(rng() * (b - a + 1));

export const chestRarityForDifficulty = (difficulty: number) => {
  for (const t of C.GEAR_CHEST_TIERS) if (difficulty <= t.maxDifficulty) return t.rarity;
  return C.GEAR_CHEST_TIERS[C.GEAR_CHEST_TIERS.length - 1].rarity;
};

export const rollGear = (id: string, rarity: string, rng: Rng): GearItem => {
  const rar = C.GEAR_RARITY[rarity] ? rarity : 'common';
  const rIdx = Math.max(0, C.GEAR_RARITY_ORDER.indexOf(rar));
  const ids = Object.keys(C.GEAR_PIECES).filter((pid) => !C.GEAR_PIECES[pid].unique);
  const eligible = ids.filter((pid) => C.GEAR_RARITY_ORDER.indexOf(C.GEAR_PIECES[pid].maxRarity) >= rIdx);
  const pieceId = (eligible.length ? eligible : ids)[Math.floor(rng() * (eligible.length ? eligible.length : ids.length))];
  const def = C.GEAR_PIECES[pieceId];
  const capIdx = C.GEAR_RARITY_ORDER.indexOf(def.maxRarity);
  const instRarity = C.GEAR_RARITY_ORDER[Math.min(rIdx, capIdx)];
  const base = C.GEAR_GEN.basePower + rIdx * C.GEAR_GEN.perTier + randInt(0, 3, rng);
  return { id, pieceId, slot: def.slot, rarity: instRarity, level: 1, base, equippedTo: null };
};

export const makeUnique = (id: string, pieceId: string, rng: Rng): GearItem | null => {
  const def = C.GEAR_PIECES[pieceId];
  if (!def || !def.unique) return null;
  const rarity = C.GEAR_RARITY[def.maxRarity] ? def.maxRarity : 'common';
  const rIdx = Math.max(0, C.GEAR_RARITY_ORDER.indexOf(rarity));
  const base = C.GEAR_GEN.basePower + rIdx * C.GEAR_GEN.perTier + randInt(0, 3, rng);
  return { id, pieceId, slot: def.slot, rarity, level: 1, base, equippedTo: null, unique: true };
};

export const autoEquipAll = (gearMap: GearMap, rankedHeroIds: string[]): GearMap => {
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k], equippedTo: null };
  for (const slot of C.GEAR_SLOTS) {
    const pool = Object.values(next).filter((g) => g.slot === slot).sort((a, b) => gearPower(b) - gearPower(a));
    rankedHeroIds.forEach((hid, i) => { if (pool[i]) next[pool[i].id].equippedTo = hid; });
  }
  return next;
};

export const autoEquipHero = (gearMap: GearMap, heroId: string): GearMap => {
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k] };
  for (const slot of C.GEAR_SLOTS) {
    const cand = Object.values(next).filter((g) => g.slot === slot && (g.equippedTo === null || g.equippedTo === heroId)).sort((a, b) => gearPower(b) - gearPower(a));
    for (const g of Object.values(next)) if (g.slot === slot && g.equippedTo === heroId) g.equippedTo = null;
    if (cand[0]) next[cand[0].id].equippedTo = heroId;
  }
  return next;
};

const levelPool = (gearMap: GearMap, ids: string[], pool: number) => {
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k] };
  let xp = pool, guard = 0;
  while (guard++ < 5000) {
    let best: string | null = null, bestCost = Infinity;
    for (const id of ids) { const g = next[id]; if (!g || gearAtMax(g)) continue; const c = gearLevelCost(g.level); if (c <= xp && c < bestCost) { bestCost = c; best = id; } }
    if (best === null) break;
    next[best] = { ...next[best], level: next[best].level + 1 };
    xp -= bestCost;
  }
  return { gear: next, xp };
};
export const autoLevelAll = (gearMap: GearMap, pool: number) => levelPool(gearMap, Object.values(gearMap).filter((g) => g.equippedTo).map((g) => g.id), pool);
export const autoLevelHero = (gearMap: GearMap, heroId: string, pool: number) => levelPool(gearMap, Object.values(gearMap).filter((g) => g.equippedTo === heroId).map((g) => g.id), pool);

export const canLevelGear = (g: GearItem, pool: number) => !!g && !gearAtMax(g) && pool >= gearLevelCost(g.level);
export const levelGear = (gearMap: GearMap, id: string, pool: number) => {
  const g = gearMap[id];
  if (!canLevelGear(g, pool)) return { gear: gearMap, xp: pool };
  const cost = gearLevelCost(g.level);
  return { gear: { ...gearMap, [id]: { ...g, level: g.level + 1 } }, xp: pool - cost };
};

export const nextRarity = (rarity: string) => { const i = C.GEAR_RARITY_ORDER.indexOf(rarity); return i >= 0 && i < C.GEAR_RARITY_ORDER.length - 1 ? C.GEAR_RARITY_ORDER[i + 1] : null; };
export const nextRarityFor = (g: GearItem) => {
  if (!g) return null;
  const cur = C.GEAR_RARITY_ORDER.indexOf(g.rarity);
  const cap = C.GEAR_RARITY_ORDER.indexOf(pieceMaxRarity(g));
  return cur >= 0 && cur < cap && cur < C.GEAR_RARITY_ORDER.length - 1 ? C.GEAR_RARITY_ORDER[cur + 1] : null;
};
export const fuseFodder = (gearMap: GearMap, id: string) => {
  const g = gearMap[id];
  if (!g || !nextRarityFor(g)) return [];
  return Object.values(gearMap).filter((x) => x.id !== g.id && x.slot === g.slot && x.rarity === g.rarity && !x.equippedTo);
};
export const canFuse = (gearMap: GearMap, id: string) => fuseFodder(gearMap, id).length >= C.GEAR_FUSE.fodder;
export const fuseCost = (rarity: string) => C.GEAR_FUSE.coinBase + Math.max(0, C.GEAR_RARITY_ORDER.indexOf(rarity)) * C.GEAR_FUSE.coinPerTier;
export const canAffordFuse = (gearMap: GearMap, id: string, coins: number) => { const g = gearMap[id]; return !!g && canFuse(gearMap, id) && coins >= fuseCost(g.rarity); };
export const fuseGear = (gearMap: GearMap, id: string): GearMap => {
  if (!canFuse(gearMap, id)) return gearMap;
  const g = gearMap[id];
  const nr = nextRarityFor(g);
  if (!nr) return gearMap;
  const sacrifice = new Set(fuseFodder(gearMap, id).sort((a, b) => gearPower(a) - gearPower(b)).slice(0, C.GEAR_FUSE.fodder).map((x) => x.id));
  const next: GearMap = {};
  for (const k in gearMap) { const item = gearMap[k]; if (sacrifice.has(item.id)) continue; next[k] = item.id === g.id ? { ...item, rarity: nr } : { ...item }; }
  return next;
};

export const equippedInSlot = (gearMap: GearMap, heroId: string, slot: string) => Object.values(gearMap).find((g) => g.slot === slot && g.equippedTo === heroId) || null;
export const slotCandidates = (gearMap: GearMap, heroId: string, slot: string) => {
  const cur = equippedInSlot(gearMap, heroId, slot);
  return Object.values(gearMap).filter((g) => g.slot === slot && (g.equippedTo === null || g.equippedTo === heroId) && (!cur || g.id !== cur.id)).sort((a, b) => gearPower(b) - gearPower(a));
};
export const equipItem = (gearMap: GearMap, id: string, heroId: string): GearMap => {
  const g = gearMap[id];
  if (!g) return gearMap;
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k] };
  for (const k in next) if (next[k].slot === g.slot && next[k].equippedTo === heroId) next[k].equippedTo = null;
  next[id].equippedTo = heroId;
  return next;
};
export const levelAllHeroOnce = (gearMap: GearMap, heroId: string, pool: number) => {
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k] };
  let xp = pool;
  for (const g of Object.values(next)) { if (g.equippedTo !== heroId || gearAtMax(g)) continue; const c = gearLevelCost(g.level); if (c <= xp) { g.level += 1; xp -= c; } }
  return { gear: next, xp };
};
export const canEquipBetter = (gearMap: GearMap, heroId: string) => {
  const after = autoEquipHero(gearMap, heroId);
  const slotId = (map: GearMap, slot: string) => { const g = Object.values(map).find((x) => x.slot === slot && x.equippedTo === heroId); return g ? g.id : null; };
  return C.GEAR_SLOTS.some((slot: string) => slotId(gearMap, slot) !== slotId(after, slot));
};
export const canUpgradeHeroGear = (gearMap: GearMap, heroId: string, pool: number) => equippedFor(gearMap, heroId).some((g) => !gearAtMax(g) && gearLevelCost(g.level) <= pool);
