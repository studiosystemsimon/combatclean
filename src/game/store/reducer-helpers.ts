// === reducer helpers — shared orchestration primitives for the store's reducer slices ===
// Moved verbatim from reducer.ts (the pre-switch helpers + buildBattle + initState) so every slice
// (reducer-shell/board/orders/combat/gacha/heroes/gear) reads ONE copy. Pure model transforms +
// owned ids/randomness/time; no per-slice logic here. Reads content C; randomness = the seeded `rng`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Board from '../board/board.ts';
import * as Energy from '../energy/energy.ts';
import * as Orders from '../orders/orders.ts';
import * as Battle from '../combat/battle.ts';
import * as Gacha from '../gacha/gacha.ts';
import * as Gear from '../gear/gear.ts';
import { heroStats, heroAbilityMul, newCharacter } from '../heroes/heroes.ts';
import * as Map from '../map/map.ts';
import { C } from '../content.ts';
import { rng } from '../sim-random.ts';

type S = any; // MergeCombat's runtime state shape (dynamic); persisted slice maps to the account.

export const squadOf = (order: string[]) => order.slice(0, C.BOARD.selectedSlots);

// Order eligibility: which order-chains are requestable given the currently-unlocked generators. A
// chain is eligible only if a generator that produces it is unlocked (so no magic orders pre-unlock).
export const orderChainsFor = (unlocked: string[]): string[] =>
  C.ORDER_CHAINS.filter((chain: string) => unlocked.some((g) => C.GENERATORS[g] && C.GENERATORS[g].chain === chain));

// Backfill the unlocked-generator set from clearedLevel (for saves without an explicit set): start
// with STARTING_GENERATORS + every generator whose unlocking area's boss has already been BEATEN.
export const deriveUnlockedGenerators = (clearedLevel: number): string[] => {
  const set = new Set<string>(C.STARTING_GENERATORS);
  C.ZONES.forEach((z: any, i: number) => {
    if (clearedLevel >= (i + 1) * C.ZONE_LEN) (z.unlocksGenerators || []).forEach((g: string) => set.add(g));
  });
  return [...set];
};

export const battleStatsFor = (heroesMap: any, gearMap: any, ordersCompleted: number) => (cid: string) => {
  const char = heroesMap[cid];
  return { ...heroStats(char.hero, char, ordersCompleted, Gear.heroGearPower(gearMap, cid)), abilityMul: heroAbilityMul(char), hero: char.hero };
};
export const rescaleHero = (bh: any, stats: any) => ({
  ...bh, atk: stats.atk, maxHp: stats.maxHp,
  hp: Math.max(1, Math.round((bh.hp / bh.maxHp) * stats.maxHp)),
  abilityMul: stats.abilityMul != null ? stats.abilityMul : bh.abilityMul,
});
export const rescaleBattle = (battle: any, statsFn: any) => battle.heroes.map((bh: any) => rescaleHero(bh, statsFn(bh.id)));

export const respawn = (state: S, level: number, id0: number) => {
  let id = id0;
  const wave = Battle.buildWave(level, rng, () => id++);
  const heroes = state.battle.heroes.map((h: any) => ({ ...h, hp: h.maxHp }));
  return { wave, heroes, id };
};

export const winReward = (level: number) => {
  const R = C.BATTLE.reward; const m = Map.nodeRewardMul(level);
  return {
    heroXp: Math.round((R.heroXpBase + R.heroXpPerLevel * level) * m),
    gearXp: Math.round((R.gearXpBase + R.gearXpPerLevel * level) * m),
    coins: Math.round((R.coinsBase + R.coinsPerLevel * level) * m),
  };
};
export const rollWinCrystal = (level: number) => {
  if (rng() >= C.CRYSTAL.dropChance) return null;
  return { rarity: Map.crystalForLevel(level), amount: C.CRYSTAL.dropAmount };
};
export const addCrystal = (crystals: any, drop: any) => drop ? { ...crystals, [drop.rarity]: (crystals[drop.rarity] || 0) + drop.amount } : crystals;
export const sumAfk = (a: any, b: any) => ({ ms: (a?.ms || 0) + (b?.ms || 0), coins: (a?.coins || 0) + (b?.coins || 0), heroXp: (a?.heroXp || 0) + (b?.heroXp || 0), gearXp: (a?.gearXp || 0) + (b?.gearXp || 0) });

export const buildBattle = (heroes: any, gear: any, order: string[], ordersCompleted: number, level: number, startId: number, status = 'fighting') => {
  let id = startId;
  const statsFn = battleStatsFor(heroes, gear, ordersCompleted);
  const wave = Battle.buildWave(level, rng, () => id++);
  const battle = { level, wave, heroes: Battle.buildHeroes(squadOf(order), statsFn), status, recovering: false, focusUid: null };
  return { battle, nextId: id };
};

export const initState = (now: number, saved: any = null): S => {
  let id = 1;
  const heroes: any = {}; const order: string[] = []; let cid = 1;
  for (const hero of C.STARTER_HEROES) { const c = `c${cid++}`; heroes[c] = newCharacter(c, hero, C.HEROES[hero].rarity); order.push(c); }
  const gear: any = {}; const ordersCompleted = 0;

  // Only UNLOCKED generators are placed at boot; e.g. the magic generator appears only once the fens is beaten.
  const unlockedGenerators = C.STARTING_GENERATORS;
  let board = Board.emptyBoard();
  C.BOARD.startLayout.generators
    .filter((g: { generator: string; cell: number }) => unlockedGenerators.includes(g.generator))
    .forEach((g: { generator: string; cell: number }) => { board = Board.withCell(board, g.cell, Board.makeGenerator(id++, g.generator)); });
  C.BOARD.startLayout.seedItems.forEach((s: any) => { board = Board.withCell(board, s.cell, Board.makeItem(id++, s.chain, s.level, s.locked)); });

  const startWeights = Map.zoneForLevel(C.BATTLE.startLevel).orderRarity;
  const eligibleChains = orderChainsFor(unlockedGenerators);
  const orders: any[] = [];
  // Special orders are LOCKED at boot (allowSpecial=false) — the FTUE flips flags.specialOrders on later.
  for (let i = 0; i < C.ORDER_CONFIG.active; i++) orders.push(Orders.rollOrder(id++, rng, startWeights, eligibleChains, null, null, false));

  const built = buildBattle(heroes, gear, order, ordersCompleted, C.BATTLE.startLevel, id, 'intro');
  id = built.nextId;

  const pity: any = {};
  for (const bid of Object.keys(C.BANNERS)) pity[bid] = Gacha.initPity(C.BANNERS[bid]);

  const fresh: S = {
    screen: 'merge', board, energy: Energy.initEnergy(now), now,
    coins: 0, heroXp: 0, gearXp: 0,
    heroes, gear, order, ordersCompleted, orders, battle: built.battle, pity,
    nextId: id, nextCid: cid, fx: [], lastPull: null,
    clearedLevel: C.BATTLE.startLevel - 1, pendingAfk: null, // progression/AFK stream = highest level BEATEN (persisted)
    crystals: { ...C.EMPTY_CRYSTALS },
    menuHeroId: null, // UI-only: cid whose full-screen hero menu is open (unpersisted)
    afkOpen: false, // UI-only: the AFK collection popup is open (unpersisted; auto-set on load when idle ≥ alertMs)
    headless: false, // UI-only: background mode — view unmounted, engine keeps ticking (unpersisted)
    minigame: null, // UI-only: active minigame { id, input } (full screen; engine runs headless), null when none (unpersisted)
    rewardPopup: null, // UI-only: { reward, source } shown after a minigame/server reward, null when none (unpersisted)
    unlockedGenerators, // generator keys currently unlocked (drives board placement + order eligibility)
    flags: {}, // persisted feature/FTUE flags (e.g. flags.specialOrders gates special orders; set during the FTUE)
    pendingArea: null, // { zoneIdx, nextLevel, unlocked } while the AREA COMPLETE gate is showing
    replayReturn: null, // level to warp back to after finishing a REPLAYED earlier zone (null = normal progression)
  };
  if (!saved) return fresh;

  const { lastSeen = now, ...savedRest } = saved;
  const merged = { ...fresh, ...savedRest, now, fx: [], lastPull: null };
  const level = (saved.battle && saved.battle.level) || fresh.battle.level;
  const rebuilt = buildBattle(merged.heroes, merged.gear, merged.order, merged.ordersCompleted, level, merged.nextId);
  // Progression stream: highest level BEATEN (persistence migrates old furthestLevel→clearedLevel). Never
  // below the current fight − 1, so it survives a replay where battle.level is lower than the frontier.
  const clearedLevel = Math.max(saved.clearedLevel ?? 0, level - 1);
  const add = Map.afkEarnings(clearedLevel, now - lastSeen);
  const prior = saved.pendingAfk && (saved.pendingAfk.coins || saved.pendingAfk.heroXp || saved.pendingAfk.gearXp) ? saved.pendingAfk : null;
  const showAdd = add.ms >= C.AFK.minReportMs && (add.coins || add.heroXp || add.gearXp);
  const pendingAfk = prior ? (showAdd ? sumAfk(prior, add) : prior) : (showAdd ? add : null);
  const crystals = { ...C.EMPTY_CRYSTALS, ...(saved.crystals || {}) };
  // Restore the unlocked-generator set; backfill from clearedLevel for saves predating this field.
  const loadedUnlocked = (saved.unlockedGenerators && saved.unlockedGenerators.length) ? saved.unlockedGenerators : deriveUnlockedGenerators(clearedLevel);
  // Auto-open the AFK collection popup on login when idle rewards reached the alert threshold (≥ alertMs) —
  // the player sees the welcome-back popup BEFORE gameplay.
  const afkOpen = !!(pendingAfk && pendingAfk.ms >= C.AFK.alertMs);
  // Order-flow self-heal (refresh robustness). Redemption advances an order through TRANSIENT states:
  // fulfil → `fulfilling:true` → (orderChest fx) → EMPTY_ORDER → `pending` → (rail countdown) → fill.
  // A refresh persists that transient order (features.merge.orders) but the fx queue is rebuilt empty on
  // load, so a `fulfilling` order never receives its EMPTY_ORDER and sits forever as a dead, un-fulfillable
  // card. The reward was already granted at fulfil time, so finish what the lost fx would have done: turn
  // each stranded `fulfilling` order into a fresh PENDING slot (the rail refills it normally). Pending
  // slots and healthy active orders pass through unchanged; malformed entries collapse to pending too.
  let oid = rebuilt.nextId;
  const reconciledOrders = (merged.orders || []).map((o: any) => {
    if (!o || typeof o !== 'object') return { id: oid++, pending: true, dur: C.ORDER_CONFIG.arrivalMs };
    if (o.pending) return o;
    if (o.fulfilling) return { id: o.id != null ? o.id : oid++, pending: true, dur: C.ORDER_CONFIG.arrivalMs };
    if (Array.isArray(o.items) && o.items.length) return o;
    return { id: o.id != null ? o.id : oid++, pending: true, dur: C.ORDER_CONFIG.arrivalMs };
  });
  return { ...merged, battle: rebuilt.battle, nextId: oid, orders: reconciledOrders, clearedLevel, pendingAfk, afkOpen, crystals, unlockedGenerators: loadedUnlocked, pendingArea: null };
};
