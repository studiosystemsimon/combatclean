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

// "Best" ordering for auto-equip: RARITY is the first axis (rarest wins), then LEVEL (highest wins),
// then gearPower only as a final tiebreak when rarity AND level are equal. rarityIdx = position in
// C.GEAR_RARITY_ORDER (low→high), so a higher index is rarer.
const rarityIdx = (g: GearItem) => C.GEAR_RARITY_ORDER.indexOf(g.rarity);
const byBest = (a: GearItem, b: GearItem) => rarityIdx(b) - rarityIdx(a) || b.level - a.level || gearPower(b) - gearPower(a);

// ── per-class loadout + equip gating ─────────────────────────────────────────
// The generic modular slot system: a hero-class declares its slot loadout (its own `slots`, else the
// shared gearLoadout.defaultSlots), and a class-bound slot only accepts pieces whose classKey matches.
type Cls = { slots: string[]; classKey?: string };
export const slotClassBound = (slotKey: string) => !!(C.GEAR_SLOT_DEFS[slotKey] && C.GEAR_SLOT_DEFS[slotKey].classBound);
export const heroClassOf = (heroSlug: string): Cls => {
  const h = C.HEROES[heroSlug];
  return { slots: ((h && h.slots) || C.GEAR_LOADOUT.defaultSlots) as string[], classKey: h && h.classKey };
};
export const slotsForClass = (heroSlug: string) => heroClassOf(heroSlug).slots;
// A gear instance fits a class's slot: right family, the class HAS that slot, and (class-bound slots
// only) the piece's classKey matches the class.
export const fitsSlot = (g: GearItem, cls: Cls, slotKey: string) =>
  !!g && g.slot === slotKey && cls.slots.includes(slotKey)
  && (!slotClassBound(slotKey) || (pieceDef(g)?.classKey ?? null) === (cls.classKey ?? null));
export const canEquip = (g: GearItem, cls: Cls) => fitsSlot(g, cls, g.slot);

const randInt = (a: number, b: number, rng: Rng) => a + Math.floor(rng() * (b - a + 1));

export const chestRarityForDifficulty = (difficulty: number) => {
  for (const t of C.GEAR_CHEST_TIERS) if (difficulty <= t.maxDifficulty) return t.rarity;
  return C.GEAR_CHEST_TIERS[C.GEAR_CHEST_TIERS.length - 1].rarity;
};

export const rollGear = (id: string, rarity: string, rng: Rng): GearItem => {
  const rar = C.GEAR_RARITY[rarity] ? rarity : 'common';
  const rIdx = Math.max(0, C.GEAR_RARITY_ORDER.indexOf(rar));
  const ids = Object.keys(C.GEAR_PIECES).filter((pid) => !C.GEAR_PIECES[pid].unique && !C.GEAR_PIECES[pid].classKey);
  const eligible = ids.filter((pid) => C.GEAR_RARITY_ORDER.indexOf(C.GEAR_PIECES[pid].maxRarity) >= rIdx);
  const pieceId = (eligible.length ? eligible : ids)[Math.floor(rng() * (eligible.length ? eligible.length : ids.length))];
  const def = C.GEAR_PIECES[pieceId];
  const capIdx = C.GEAR_RARITY_ORDER.indexOf(def.maxRarity);
  const instRarity = C.GEAR_RARITY_ORDER[Math.min(rIdx, capIdx)];
  const base = C.GEAR_GEN.basePower + rIdx * C.GEAR_GEN.perTier + randInt(0, C.GEAR_GEN.powerSpread, rng);
  return { id, pieceId, slot: def.slot, rarity: instRarity, level: 1, base, equippedTo: null };
};

// Scripted grant (e.g. the FTUE's forced second-order reward): roll a piece constrained to a specific
// SLOT — otherwise identical to rollGear (rarity floor + per-piece maxRarity cap + power spread). Falls
// back to a generic roll if the slot has no eligible (non-unique, non-class-bound) piece.
export const rollGearInSlot = (id: string, slot: string, rarity: string, rng: Rng): GearItem => {
  const rar = C.GEAR_RARITY[rarity] ? rarity : 'common';
  const rIdx = Math.max(0, C.GEAR_RARITY_ORDER.indexOf(rar));
  const pool = Object.keys(C.GEAR_PIECES).filter((pid) => C.GEAR_PIECES[pid].slot === slot && !C.GEAR_PIECES[pid].unique && !C.GEAR_PIECES[pid].classKey);
  if (!pool.length) return rollGear(id, rarity, rng);
  const eligible = pool.filter((pid) => C.GEAR_RARITY_ORDER.indexOf(C.GEAR_PIECES[pid].maxRarity) >= rIdx);
  const pieceId = (eligible.length ? eligible : pool)[Math.floor(rng() * (eligible.length ? eligible.length : pool.length))];
  const def = C.GEAR_PIECES[pieceId];
  const capIdx = C.GEAR_RARITY_ORDER.indexOf(def.maxRarity);
  const instRarity = C.GEAR_RARITY_ORDER[Math.min(rIdx, capIdx)];
  const base = C.GEAR_GEN.basePower + rIdx * C.GEAR_GEN.perTier + randInt(0, C.GEAR_GEN.powerSpread, rng);
  return { id, pieceId, slot: def.slot, rarity: instRarity, level: 1, base, equippedTo: null };
};

export const makeUnique = (id: string, pieceId: string, rng: Rng): GearItem | null => {
  const def = C.GEAR_PIECES[pieceId];
  if (!def || !def.unique) return null;
  const rarity = C.GEAR_RARITY[def.maxRarity] ? def.maxRarity : 'common';
  const rIdx = Math.max(0, C.GEAR_RARITY_ORDER.indexOf(rarity));
  const base = C.GEAR_GEN.basePower + rIdx * C.GEAR_GEN.perTier + randInt(0, C.GEAR_GEN.powerSpread, rng);
  return { id, pieceId, slot: def.slot, rarity, level: 1, base, equippedTo: null, unique: true };
};

// Equip one hero IN PLACE on an already-owned working copy (NO clone). One pass over the map clears this
// hero's items in its class slots (so they re-compete) and buckets the free candidates by slot; then each
// slot takes its best (rarity→level→power via byBest). Shared by autoEquipHero + autoEquipAll.
const equipHeroInPlace = (next: GearMap, heroId: string, cls: Cls): void => {
  const slotSet = new Set(cls.slots);
  const bySlot: Record<string, GearItem[]> = {};
  for (const slot of cls.slots) bySlot[slot] = [];
  for (const id in next) {
    const g = next[id];
    if (!slotSet.has(g.slot)) continue;
    if (g.equippedTo === heroId) g.equippedTo = null; // unequip current so it re-competes with the free pool
    if (g.equippedTo === null && fitsSlot(g, cls, g.slot)) bySlot[g.slot].push(g);
  }
  for (const slot of cls.slots) {
    const cand = bySlot[slot];
    if (!cand.length) continue;
    let best = cand[0];
    for (let i = 1; i < cand.length; i++) if (byBest(cand[i], best) < 0) best = cand[i];
    best.equippedTo = heroId;
  }
};

// Rank-ordered heroes each greedily take their best free gear per THEIR class's slots (heroes may have
// different loadouts + class-bound slots), so the highest-ranked hero fills first. ONE map clone total.
export const autoEquipAll = (gearMap: GearMap, ranked: { id: string; cls: Cls }[]): GearMap => {
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k], equippedTo: null };
  for (const { id, cls } of ranked) equipHeroInPlace(next, id, cls);
  return next;
};

export const autoEquipHero = (gearMap: GearMap, heroId: string, cls: Cls): GearMap => {
  const next: GearMap = {};
  for (const k in gearMap) next[k] = { ...gearMap[k] };
  equipHeroInPlace(next, heroId, cls);
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
  const bound = slotClassBound(g.slot);
  const ck = bound ? (pieceDef(g)?.classKey ?? null) : null;
  return Object.values(gearMap).filter((x) => x.id !== g.id && x.slot === g.slot && x.rarity === g.rarity && !x.equippedTo && (!bound || (pieceDef(x)?.classKey ?? null) === ck));
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
export const slotCandidates = (gearMap: GearMap, heroId: string, slot: string, cls: Cls) => {
  const cur = equippedInSlot(gearMap, heroId, slot);
  return Object.values(gearMap).filter((g) => fitsSlot(g, cls, slot) && (g.equippedTo === null || g.equippedTo === heroId) && (!cur || g.id !== cur.id)).sort((a, b) => gearPower(b) - gearPower(a));
};
// Items of this slot currently worn by OTHER heroes THIS class can wear — offered AFTER the free pool.
// equipItem moves them off the other hero on equip; the view gates that behind a confirm dialog.
export const otherHeroSlotItems = (gearMap: GearMap, heroId: string, slot: string, cls: Cls) =>
  Object.values(gearMap).filter((g) => fitsSlot(g, cls, slot) && g.equippedTo && g.equippedTo !== heroId).sort((a, b) => gearPower(b) - gearPower(a));
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
export const canEquipBetter = (gearMap: GearMap, heroId: string, cls: Cls) => {
  const after = autoEquipHero(gearMap, heroId, cls);
  const slotId = (map: GearMap, slot: string) => { const g = Object.values(map).find((x) => x.slot === slot && x.equippedTo === heroId); return g ? g.id : null; };
  return cls.slots.some((slot: string) => slotId(gearMap, slot) !== slotId(after, slot));
};
export const canUpgradeHeroGear = (gearMap: GearMap, heroId: string, pool: number) => equippedFor(gearMap, heroId).some((g) => !gearAtMax(g) && gearLevelCost(g.level) <= pool);
