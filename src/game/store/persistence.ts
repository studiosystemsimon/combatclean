// === persistence — the runtime slice ↔ the six-section account blob (ported from MergeCombat persistence.js) ===
// MergeCombat persisted a hand-picked state slice to localStorage. combatclean routes the SAME slice
// through the six-section account model (the sanctioned persistence): wallets→resources (id-keyed),
// owned heroes+gear→items (instances), the rest→profile/features. Save maps runtime→blob; load maps
// blob→slice, which initState's `saved` overlay rebuilds from. ONE persistence path (the account).
import type { ClientAccountView, ItemInstance } from '@bishop/meta-contract';
import { createLocalStore } from '../../account/store.ts';
import { RES, ACCOUNT_DOC } from '../../account/account.ts';
import { C } from '../content.ts';

// v2: generators became levelled board tiles (BoardGenerator gained `level`); bumping discards
// pre-v2 saves whose board could hold level-less generators or stale pre-migration chains.
const SCHEMA_VERSION = 2;
const store = createLocalStore();

// The persistable runtime slice (exactly MergeCombat's pickPersistable set).
export function pickPersistable(state: any) {
  return {
    screen: state.screen, board: state.board, energy: state.energy,
    coins: state.coins, heroXp: state.heroXp, gearXp: state.gearXp,
    heroes: state.heroes, gear: state.gear, order: state.order,
    ordersCompleted: state.ordersCompleted, orders: state.orders, pity: state.pity,
    nextId: state.nextId, nextCid: state.nextCid, battle: { level: state.battle.level },
    clearedLevel: state.clearedLevel, replayReturn: state.replayReturn, crystals: state.crystals, pendingAfk: state.pendingAfk,
    unlockedGenerators: state.unlockedGenerators,
    lastSeen: state.now,
  };
}

// runtime slice → six-section account blob.
export function toBlob(slice: any): ClientAccountView {
  const resources: Record<string, number> = {
    [RES.coins()]: slice.coins, [RES.heroXp()]: slice.heroXp, [RES.gearXp()]: slice.gearXp,
    [RES.energy()]: slice.energy.current,
  };
  for (const k of C.HERO_RARITY_ORDER) resources[RES.crystal(k)] = (slice.crystals && slice.crystals[k]) || 0;

  const items: ItemInstance[] = [];
  for (const cid of Object.keys(slice.heroes)) {
    const ch = slice.heroes[cid];
    items.push({ iid: cid, configId: C.heroSlugToId[ch.hero], kind: 'hero', level: ch.level, abilityLevel: ch.abilityLevel, rarity: ch.rarity });
  }
  for (const gid of Object.keys(slice.gear)) {
    const g = slice.gear[gid];
    items.push({ iid: String(gid), configId: C.pieceSlugToId[g.pieceId], kind: 'gear', slot: g.slot, rarity: g.rarity, level: g.level, base: g.base, equippedTo: g.equippedTo, unique: !!g.unique });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    resources, unlocks: [], items,
    profile: {
      order: slice.order, ordersCompleted: slice.ordersCompleted, pity: slice.pity,
      unlockedGenerators: slice.unlockedGenerators,
      clearedLevel: slice.clearedLevel, replayReturn: slice.replayReturn, pendingAfk: slice.pendingAfk, screen: slice.screen,
      nextId: slice.nextId, nextCid: slice.nextCid, lastSeen: slice.lastSeen,
      energyLastRegenAt: slice.energy.lastRegenAt,
    },
    features: { merge: { board: slice.board, orders: slice.orders }, battle: { level: slice.battle.level } },
  };
}

// six-section account blob → runtime slice (the shape initState's `saved` overlay expects).
export function fromBlob(blob: ClientAccountView): any {
  const p: any = blob.profile || {};
  const f: any = blob.features || {};
  const res = blob.resources || {};
  const heroes: any = {}; const gear: any = {};
  for (const it of blob.items || []) {
    if ((it as any).kind === 'hero') heroes[it.iid] = { cid: it.iid, hero: C.heroIdToSlug[it.configId], level: (it as any).level, abilityLevel: (it as any).abilityLevel, rarity: (it as any).rarity };
    else if ((it as any).kind === 'gear') { gear[it.iid] = { id: it.iid, pieceId: C.pieceIdToSlug[it.configId], slot: (it as any).slot, rarity: (it as any).rarity, level: (it as any).level, base: (it as any).base, equippedTo: (it as any).equippedTo, unique: (it as any).unique }; }
  }
  const crystals: Record<string, number> = {};
  for (const k of C.HERO_RARITY_ORDER) crystals[k] = res[String(RES.crystal(k))] || 0;
  return {
    screen: p.screen, board: f.merge?.board, energy: { current: res[String(RES.energy())] || 0, max: C.ENERGY.max, lastRegenAt: p.energyLastRegenAt || 0 },
    coins: res[String(RES.coins())] || 0, heroXp: res[String(RES.heroXp())] || 0, gearXp: res[String(RES.gearXp())] || 0,
    heroes, gear, order: p.order || [], ordersCompleted: p.ordersCompleted || 0, orders: f.merge?.orders || [],
    pity: p.pity || {}, nextId: p.nextId || 1, nextCid: p.nextCid || 1, battle: { level: f.battle?.level || 1 },
    // Progression stream: highest level BEATEN. Migrate pre-rename saves whose profile.furthestLevel was
    // "reached" (= cleared + 1). Persist the replay warp-back so it survives a refresh mid-replay.
    clearedLevel: p.clearedLevel != null ? p.clearedLevel : Math.max(0, (p.furthestLevel || 1) - 1),
    replayReturn: p.replayReturn ?? null, crystals, pendingAfk: p.pendingAfk || null, lastSeen: p.lastSeen,
    unlockedGenerators: p.unlockedGenerators, // may be undefined for old saves → initState backfills from clearedLevel
  };
}

export function save(state: any): void { try { store.write(ACCOUNT_DOC, toBlob(pickPersistable(state))); } catch { /* non-authoritative */ } }
export function loadSaved(): any | null {
  try {
    const blob = store.read<ClientAccountView>(ACCOUNT_DOC);
    if (!blob || blob.schemaVersion !== SCHEMA_VERSION) return null;
    const slice = fromBlob(blob);
    // Guard against an incomplete/foreign blob (no merge feature) → let initState build a clean fresh
    // start rather than feed `board: undefined` into the reducer (which would crash on board.map).
    if (!slice.board) return null;
    return slice;
  } catch { return null; }
}
export function clearSaved(): void { try { store.write(ACCOUNT_DOC, null as any); } catch { /* ignore */ } }
