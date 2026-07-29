// === reducer — the game orchestration (ported near-verbatim from MergeCombat controller/reducer.js) ===
// Pure model transforms + owned ids/randomness/time. Emits pure-data VFX events on state.fx (the
// facade converts these to GameSignals). Squad = first C.BOARD.selectedSlots of state.order. Reads the
// content singleton C; randomness = the seeded `rng` (sim-random). State shape is MergeCombat's in-memory
// runtime; its PERSISTED slice maps to the six-section account (src/account) — see persistence.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Board from '../board/board.ts';
import * as Merge from '../merge/merge.ts';
import * as Energy from '../energy/energy.ts';
import * as Gen from '../generator/generator.ts';
import * as Orders from '../orders/orders.ts';
import * as Battle from '../combat/battle.ts';
import * as Gacha from '../gacha/gacha.ts';
import * as Prog from '../progression/progression.ts';
import * as Gear from '../gear/gear.ts';
import { heroStats, heroPower, newCharacter, heroAbilityMul, ascendChar, canAscendChar, ascendSelection } from '../heroes/heroes.ts';
import * as Map from '../map/map.ts';
import { C } from '../content.ts';
import { rng } from '../sim-random.ts';
import { A } from './actions.ts';

type S = any; // MergeCombat's runtime state shape (dynamic); persisted slice maps to the account.
type Act = any;

const squadOf = (order: string[]) => order.slice(0, C.BOARD.selectedSlots);

// Order eligibility: which order-chains are requestable given the currently-unlocked generators. A
// chain is eligible only if a generator that produces it is unlocked (so no magic orders pre-unlock).
const orderChainsFor = (unlocked: string[]): string[] =>
  C.ORDER_CHAINS.filter((chain: string) => unlocked.some((g) => C.GENERATORS[g] && C.GENERATORS[g].chain === chain));

// Backfill the unlocked-generator set from furthestLevel (for saves without an explicit set): start
// with STARTING_GENERATORS + every generator whose unlocking area has already been fully cleared.
const deriveUnlockedGenerators = (furthestLevel: number): string[] => {
  const set = new Set<string>(C.STARTING_GENERATORS);
  C.ZONES.forEach((z: any, i: number) => {
    if (furthestLevel > (i + 1) * C.ZONE_LEN) (z.unlocksGenerators || []).forEach((g: string) => set.add(g));
  });
  return [...set];
};

const battleStatsFor = (heroesMap: any, gearMap: any, ordersCompleted: number) => (cid: string) => {
  const char = heroesMap[cid];
  return { ...heroStats(char.hero, char, ordersCompleted, Gear.heroGearPower(gearMap, cid)), abilityMul: heroAbilityMul(char), hero: char.hero };
};
const rescaleHero = (bh: any, stats: any) => ({
  ...bh, atk: stats.atk, maxHp: stats.maxHp,
  hp: Math.max(1, Math.round((bh.hp / bh.maxHp) * stats.maxHp)),
  abilityMul: stats.abilityMul != null ? stats.abilityMul : bh.abilityMul,
});
const rescaleBattle = (battle: any, statsFn: any) => battle.heroes.map((bh: any) => rescaleHero(bh, statsFn(bh.id)));

const respawn = (state: S, level: number, id0: number) => {
  let id = id0;
  const wave = Battle.buildWave(level, rng, () => id++);
  const heroes = state.battle.heroes.map((h: any) => ({ ...h, hp: h.maxHp }));
  return { wave, heroes, id };
};

const winReward = (level: number) => {
  const R = C.BATTLE.reward; const m = Map.nodeRewardMul(level);
  return {
    heroXp: Math.round((R.heroXpBase + R.heroXpPerLevel * level) * m),
    gearXp: Math.round((R.gearXpBase + R.gearXpPerLevel * level) * m),
    coins: Math.round((R.coinsBase + R.coinsPerLevel * level) * m),
  };
};
const rollWinCrystal = (level: number) => {
  if (rng() >= C.CRYSTAL.dropChance) return null;
  return { rarity: Map.crystalForLevel(level), amount: C.CRYSTAL.dropAmount };
};
const addCrystal = (crystals: any, drop: any) => drop ? { ...crystals, [drop.rarity]: (crystals[drop.rarity] || 0) + drop.amount } : crystals;
const sumAfk = (a: any, b: any) => ({ ms: (a?.ms || 0) + (b?.ms || 0), coins: (a?.coins || 0) + (b?.coins || 0), heroXp: (a?.heroXp || 0) + (b?.heroXp || 0), gearXp: (a?.gearXp || 0) + (b?.gearXp || 0) });

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
  for (let i = 0; i < C.ORDER_CONFIG.active; i++) orders.push(Orders.rollOrder(id++, rng, startWeights, eligibleChains));

  const built = buildBattle(heroes, gear, order, ordersCompleted, C.BATTLE.startLevel, id, 'intro');
  id = built.nextId;

  const pity: any = {};
  for (const bid of Object.keys(C.BANNERS)) pity[bid] = Gacha.initPity(C.BANNERS[bid]);

  const fresh: S = {
    screen: 'merge', board, energy: Energy.initEnergy(now), now,
    coins: 0, heroXp: 0, gearXp: 0,
    heroes, gear, order, ordersCompleted, orders, battle: built.battle, pity,
    nextId: id, nextCid: cid, fx: [], lastPull: null,
    furthestLevel: C.BATTLE.startLevel, pendingAfk: null,
    crystals: { ...C.EMPTY_CRYSTALS },
    menuHeroId: null, // UI-only: cid whose full-screen hero menu is open (unpersisted)
    afkOpen: false, // UI-only: the AFK collection popup is open (unpersisted; auto-set on load when idle ≥ alertMs)
    unlockedGenerators, // generator keys currently unlocked (drives board placement + order eligibility)
    pendingArea: null, // { zoneIdx, nextLevel, unlocked } while the AREA COMPLETE gate is showing
  };
  if (!saved) return fresh;

  const { lastSeen = now, ...savedRest } = saved;
  const merged = { ...fresh, ...savedRest, now, fx: [], lastPull: null };
  const level = (saved.battle && saved.battle.level) || fresh.battle.level;
  const rebuilt = buildBattle(merged.heroes, merged.gear, merged.order, merged.ordersCompleted, level, merged.nextId);
  const furthestLevel = Math.max(saved.furthestLevel || 1, level);
  const add = Map.afkEarnings(furthestLevel, now - lastSeen);
  const prior = saved.pendingAfk && (saved.pendingAfk.coins || saved.pendingAfk.heroXp || saved.pendingAfk.gearXp) ? saved.pendingAfk : null;
  const showAdd = add.ms >= C.AFK.minReportMs && (add.coins || add.heroXp || add.gearXp);
  const pendingAfk = prior ? (showAdd ? sumAfk(prior, add) : prior) : (showAdd ? add : null);
  const crystals = { ...C.EMPTY_CRYSTALS, ...(saved.crystals || {}) };
  // Restore the unlocked-generator set; backfill from furthestLevel for saves predating this field.
  const loadedUnlocked = (saved.unlockedGenerators && saved.unlockedGenerators.length) ? saved.unlockedGenerators : deriveUnlockedGenerators(furthestLevel);
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
  return { ...merged, battle: rebuilt.battle, nextId: oid, orders: reconciledOrders, furthestLevel, pendingAfk, afkOpen, crystals, unlockedGenerators: loadedUnlocked, pendingArea: null };
};

export const reducer = (state: S, action: Act): S => {
  switch (action.type) {
    case A.SET_SCREEN:
      // Changing the active screen (e.g. a nav-bar tap) also closes any open hero menu sub-view.
      return { ...state, screen: action.screen, menuHeroId: null };
    case A.SET_HERO_MENU:
      // Opening clears the fx queue so no stale combat VFX flashes when FxLayer remounts on close.
      return { ...state, menuHeroId: action.heroId, fx: action.heroId ? [] : state.fx };
    case A.SET_AFK_OPEN:
      // Full-screen AFK collection popup (combat paused underneath). Clear fx on open like the hero menu.
      return { ...state, afkOpen: action.open, fx: action.open ? [] : state.fx };
    case A.SET_BATTLE_LEVEL: {
      const target = Math.max(1, Math.min(Math.floor(action.level) || 1, state.furthestLevel));
      if (target === state.battle.level) return state;
      const { wave, heroes, id } = respawn(state, target, state.nextId);
      // Map level-select is a NORMAL (losable) level — recovering (the can't-die shield)
      // is set ONLY by a loss (RESOLVE_LOSS), never by picking a level from the map.
      return { ...state, battle: { ...state.battle, level: target, wave, heroes, status: 'fighting', recovering: false, focusUid: null }, nextId: id };
    }
    case A.COLLECT_AFK: {
      const a = state.pendingAfk; if (!a) return state;
      // Claiming grants the idle rewards, clears pendingAfk (→ the AFK! tile disappears) and closes the popup.
      return { ...state, coins: state.coins + a.coins, heroXp: state.heroXp + a.heroXp, gearXp: state.gearXp + a.gearXp, pendingAfk: null, afkOpen: false };
    }
    case A.RESUME_AFK: {
      const elapsed = action.now - state.now;
      if (elapsed < C.AFK.minReportMs) return { ...state, now: action.now };
      const add = Map.afkEarnings(state.furthestLevel, elapsed);
      if (!(add.coins || add.heroXp || add.gearXp)) return { ...state, now: action.now };
      const pendingAfk = state.pendingAfk ? sumAfk(state.pendingAfk, add) : add;
      return { ...state, pendingAfk, now: action.now };
    }
    case A.SET_FOCUS_TARGET: {
      const focusUid = state.battle.focusUid === action.uid ? null : action.uid;
      return { ...state, battle: { ...state.battle, focusUid } };
    }
    case A.REGEN_TICK:
      return { ...state, energy: Energy.regen(state.energy, action.now), now: action.now };
    case A.TAP_GENERATOR: {
      const cell = state.board[action.index];
      if (!cell || cell.kind !== 'generator') return state;
      const cost = Gen.generatorCost(cell.genId);
      const energyNow = Energy.regen(state.energy, action.now);
      if (!Energy.canSpend(energyNow, cost)) return state;
      const empty = Board.firstEmptyIndex(state.board);
      if (empty < 0) return state;
      const level = Gen.rollDropLevel(cell.genId, cell.level, rng);
      const chain = Gen.generatorChain(cell.genId);
      let id = state.nextId;
      const board = Board.withCell(state.board, empty, Board.makeItem(id++, chain, level));
      const energy = Energy.spend(energyNow, cost, action.now);
      const fx = [...state.fx, { id: id++, type: 'generatorDrop' }];
      return { ...state, board, energy, fx, nextId: id, now: action.now };
    }
    case A.MOVE_OR_MERGE: {
      const { from, to } = action;
      if (from === to) return state;
      const a = state.board[from]; if (!a) return state;
      const b = state.board[to];
      if (a.kind === 'generator') {
        if (b === null) { // relocate to an empty cell
          let gb = Board.withCell(state.board, to, a); gb = Board.withCell(gb, from, null);
          return { ...state, board: gb };
        }
        if (Merge.canMergeGenerator(a, b)) { // two same-generator, same-level tiles → next level
          let id = state.nextId;
          const merged = Board.makeGenerator(id++, a.genId, a.level + 1);
          let board = Board.withCell(state.board, to, merged); board = Board.withCell(board, from, null);
          const fx = [...state.fx, { id: id++, type: 'merge', tier: a.level + 1 }]; // shared merge burst + haptic
          return { ...state, board, nextId: id, fx };
        }
        return state; // occupied by a non-mergeable cell → no-op (view snaps the generator back)
      }
      if (a.kind !== 'item') return state;
      if (a.locked) return state;
      if (b === null) {
        let board = Board.withCell(state.board, to, a); board = Board.withCell(board, from, null);
        return { ...state, board };
      }
      if (Merge.canMerge(a, b)) {
        let id = state.nextId;
        const tier = a.level + 1;
        const merged = Board.makeItem(id++, a.chain, tier);
        let board = Board.withCell(state.board, to, merged); board = Board.withCell(board, from, null);
        // Tier-mergeMinTier+ merges are a LIMIT-energy source (alongside orders): grant to the
        // lowest-charged heroes (count + amount scale with tier) and fly a charge mote to each.
        const heroes = Battle.grantMergeEnergy(state.battle.heroes, tier);
        const chargedIds = heroes.filter((h: any, i: number) => (h.limitEnergy || 0) !== (state.battle.heroes[i].limitEnergy || 0)).map((h: any) => h.id);
        const fx = [...state.fx, { id: id++, type: 'merge', tier },
          ...(chargedIds.length ? [{ id: id++, type: 'limitCharge', heroIds: chargedIds, cell: to }] : [])];
        return { ...state, board, nextId: id, fx, battle: { ...state.battle, heroes } };
      }
      // Cobwebbed (locked) tiles can't be displaced by a swap either — dropping a non-matching tile
      // onto one is a no-op (they're freed only by merging a MATCHING tile onto them, handled above).
      if (b.kind !== 'item' || b.locked) return state;
      let board = Board.withCell(state.board, to, a); board = Board.withCell(board, from, b);
      return { ...state, board };
    }
    case A.FULFILL_ORDER: {
      const order = state.orders.find((o: any) => o.id === action.orderId);
      if (!order || order.pending || order.fulfilling) return state;
      const cells = Orders.findMatchCells(state.board, order);
      if (!cells) return state;
      let id = state.nextId;
      let board = state.board;
      for (const idx of cells) board = Board.withCell(board, idx, null);
      const oldC = state.ordersCompleted; const newC = oldC + 1;
      const ratio = (1 + C.BATTLE.orderPowerBonus * newC) / (1 + C.BATTLE.orderPowerBonus * oldC);
      const bHeroes = Battle.grantOrderEnergy(state.battle.heroes.map((h: any) => ({
        ...h, atk: Math.max(1, Math.round(h.atk * ratio)), maxHp: Math.max(1, Math.round(h.maxHp * ratio)), hp: Math.max(1, Math.round(h.hp * ratio)),
      })));
      const gid = id++;
      const zoneItems = Map.itemsForLevel(state.battle.level);
      let g: any = null;
      if (zoneItems.length && rng() < C.UNIQUE_DROP.chance) g = Gear.makeUnique(String(gid), zoneItems[Math.floor(rng() * zoneItems.length)], rng);
      if (!g) g = Gear.rollGear(String(gid), order.rarity || Gear.chestRarityForDifficulty(order.difficulty), rng);
      const gear = { ...state.gear, [gid]: g };
      const orders = state.orders.map((o: any) => (o.id === order.id ? { ...order, fulfilling: true } : o));
      const items = cells.map((c: number, i: number) => ({ cell: c, chain: order.items[i].chain }));
      const fx = [
        ...state.fx,
        { id: id++, type: 'orderChest', orderId: order.id, items, orderPt: action.orderPt || null, gear: { slot: g.slot, rarity: g.rarity } },
        { id: id++, type: 'limitCharge', orderId: order.id, heroIds: bHeroes.map((h: any) => h.id) },
      ];
      return { ...state, board, orders, gear, ordersCompleted: newC, battle: { ...state.battle, heroes: bHeroes }, nextId: id, fx };
    }
    case A.FILL_ORDER_GAP: {
      const slot = state.orders.find((o: any) => o.id === action.orderId && o.pending);
      if (!slot) return state;
      let id = state.nextId;
      const weights = Map.zoneForLevel(state.battle.level).orderRarity;
      const eligibleChains = orderChainsFor(state.unlockedGenerators);
      const orders = state.orders.map((o: any) => (o.id === action.orderId ? Orders.rollOrder(id++, rng, weights, eligibleChains) : o));
      return { ...state, orders, nextId: id };
    }
    case A.EMPTY_ORDER: {
      const target = state.orders.find((o: any) => o.id === action.orderId && o.fulfilling);
      if (!target) return state;
      let id = state.nextId;
      const rest = state.orders.filter((o: any) => o.id !== action.orderId);
      const pending = { id: id++, pending: true, dur: C.ORDER_CONFIG.arrivalMs };
      return { ...state, orders: [...rest, pending], nextId: id };
    }
    case A.REROLL_ORDER: {
      const order = state.orders.find((o: any) => o.id === action.orderId);
      if (!order || order.pending || order.fulfilling) return state;
      const weights = Map.zoneForLevel(state.battle.level).orderRarity;
      const next = Orders.rerollRarity(order.rarity, rng);
      const rolled = Orders.rollOrder(order.id, rng, weights, orderChainsFor(state.unlockedGenerators), next);
      const orders = state.orders.map((o: any) => (o.id === order.id ? rolled : o));
      return { ...state, orders };
    }
    case A.BATTLE_TICK: {
      if (state.battle.status !== 'fighting') return state;
      const pre = state.battle;
      const { battle, outcome, firedNormals, firedBasics, enemyHits, bossSpecial, bossTelegraph, bossHeal, bossRaise, enemyDamage, enemyDeaths, heals, crit, combo } = Battle.battleTick(pre, action.dt, rng);
      let id = state.nextId; let fx = state.fx;
      const targetUid = Battle.effectiveTargetUid(pre);
      if (targetUid != null) fx = [...fx, { id: id++, type: 'heroAttacks', basics: firedBasics, targetUid, enemyDamage, enemyDeaths, heals, crit, firedNormals }];
      if (enemyHits.length) fx = [...fx, { id: id++, type: 'enemyAttacks', hits: enemyHits }];
      if (bossTelegraph) fx = [...fx, { id: id++, type: 'bossTelegraph', bossUid: bossTelegraph.uid }];
      if (bossSpecial) fx = [...fx, { id: id++, type: 'bossSpecial', bossUid: bossSpecial.uid, heroIds: bossSpecial.heroIds, dmg: bossSpecial.dmg }];
      if (bossHeal) fx = [...fx, { id: id++, type: 'bossHeal', bossUid: bossHeal.uid, amount: bossHeal.amount }];
      if (bossRaise) fx = [...fx, { id: id++, type: 'bossRaise', bossUid: bossRaise.uid, raised: bossRaise.raised }];
      if (combo) fx = [...fx, { id: id++, type: 'combo', uid: combo.uid, n: combo.n }];
      if (outcome === 'win') {
        const w = winReward(battle.level); const crystals = addCrystal(state.crystals, rollWinCrystal(battle.level));
        fx = [...fx, { id: id++, type: 'waveClear' }];
        return { ...state, coins: state.coins + w.coins, heroXp: state.heroXp + w.heroXp, gearXp: state.gearXp + w.gearXp, crystals, battle: { ...battle, status: 'clearing' }, nextId: id, fx };
      }
      if (outcome === 'lose') { fx = [...fx, { id: id++, type: 'lose', level: battle.level }]; return { ...state, battle: { ...battle, status: 'lost' }, nextId: id, fx }; }
      return { ...state, battle, nextId: id, fx };
    }
    case A.TAP_LIMIT: {
      const { battle, outcome, fired, enemyDamage, enemyDeaths, heals, combo } = Battle.fireLimitBreak(state.battle, action.heroId);
      if (!fired.length) return state;
      let id = state.nextId;
      let fx = [...state.fx, { id: id++, type: 'limitBreak', heroes: fired, heroId: action.heroId, enemyDamage, enemyDeaths, heals }];
      if (combo) fx = [...fx, { id: id++, type: 'combo', uid: combo.uid, n: combo.n }];
      if (outcome === 'win') {
        const w = winReward(battle.level); const crystals = addCrystal(state.crystals, rollWinCrystal(battle.level));
        fx = [...fx, { id: id++, type: 'waveClear' }];
        return { ...state, coins: state.coins + w.coins, heroXp: state.heroXp + w.heroXp, gearXp: state.gearXp + w.gearXp, crystals, battle: { ...battle, status: 'clearing' }, nextId: id, fx };
      }
      return { ...state, battle, nextId: id, fx };
    }
    case A.SHOW_COMPLETE: {
      if (state.battle.status !== 'clearing') return state;
      let id = state.nextId;
      const fx = [...state.fx, { id: id++, type: 'levelComplete', level: state.battle.level, ...winReward(state.battle.level) }];
      return { ...state, battle: { ...state.battle, status: 'won' }, nextId: id, fx };
    }
    case A.RESOLVE_WIN: {
      if (state.battle.status !== 'won') return state;
      // A recovering win no longer loops the same level — it advances to the next level
      // (a real, losable attempt again) via the normal path below, which clears recovering.
      const nextLevel = state.battle.level + 1;
      // AREA COMPLETE: beating the last level of a zone crosses into the next area. On the FIRST clear
      // (new furthest progress) STOP and gate — grant this area's generator unlocks, then wait for the
      // player to accept the popup (A.ACCEPT_AREA_COMPLETE) before the next area is entered.
      const fromZone = Map.zoneIndexForLevel(state.battle.level);
      const toZone = Map.zoneIndexForLevel(nextLevel);
      if (toZone > fromZone && nextLevel > state.furthestLevel) {
        const zone = C.ZONES[fromZone];
        const newlyUnlocked = ((zone && zone.unlocksGenerators) || []).filter((g: string) => !state.unlockedGenerators.includes(g));
        const unlockedGenerators = newlyUnlocked.length ? [...state.unlockedGenerators, ...newlyUnlocked] : state.unlockedGenerators;
        // Board-award cinematic: plan each generator's LANDING CELL now via the shared add-tile rule
        // (empty → else replace the lowest active item), so the appear→fly→land cinematic flies to the
        // exact cell ACCEPT will drop it on. Sequential picks give multiple unlocks distinct cells.
        // `reward` = the boss-clear reward, for the synopsis card.
        let id = state.nextId;
        let workBoard = state.board;
        const placements: { genKey: string; cell: number }[] = [];
        const fx = [...state.fx];
        for (const gk of newlyUnlocked) {
          const cell = Board.addTileIndex(workBoard);
          if (cell < 0) continue; // board is all generators + cobwebs — nowhere to add
          placements.push({ genKey: gk, cell });
          workBoard = Board.withCell(workBoard, cell, Board.makeGenerator(0, gk)); // reserve the cell for the next pick (id irrelevant; discarded)
          fx.push({ id: id++, type: 'generatorUnlock', genKey: gk, cell });
        }
        return {
          ...state, unlockedGenerators, fx, nextId: id,
          furthestLevel: Math.max(state.furthestLevel, nextLevel),
          battle: { ...state.battle, status: 'areaComplete', recovering: false },
          pendingArea: { zoneIdx: fromZone, nextLevel, unlocked: newlyUnlocked, placements, reward: winReward(state.battle.level) },
        };
      }
      if (Map.isBossLevel(nextLevel)) {
        const { wave, heroes, id: id2 } = respawn(state, nextLevel, state.nextId);
        return { ...state, battle: { ...state.battle, level: nextLevel, wave, heroes, status: 'gate', recovering: false }, nextId: id2, furthestLevel: Math.max(state.furthestLevel, nextLevel) };
      }
      const { wave, heroes, id: id2 } = respawn(state, nextLevel, state.nextId);
      return { ...state, battle: { ...state.battle, level: nextLevel, wave, heroes, status: 'intro', recovering: false }, nextId: id2, furthestLevel: Math.max(state.furthestLevel, nextLevel) };
    }
    case A.ACCEPT_AREA_COMPLETE: {
      if (state.battle.status !== 'areaComplete' || !state.pendingArea) return state;
      const { nextLevel, unlocked, placements } = state.pendingArea;
      let id = state.nextId;
      let board = state.board;
      // Drop each newly-unlocked generator via the shared add-tile rule. Prefer the cell PLANNED at win
      // (so it matches where the cinematic flew); if that cell was since filled by a generator/cobweb,
      // re-resolve with addTileToBoard. Falls back to a fresh resolve when no plan exists.
      const plan = (placements && placements.length) ? placements : (unlocked || []).map((genKey: string) => ({ genKey, cell: -1 }));
      for (const p of plan) {
        const cur = p.cell >= 0 ? board[p.cell] : null;
        const planOk = p.cell >= 0 && !(cur && (cur.kind === 'generator' || (cur.kind === 'item' && cur.locked)));
        board = planOk
          ? Board.withCell(board, p.cell, Board.makeGenerator(id++, p.genKey))
          : Board.addTileToBoard(board, Board.makeGenerator(id++, p.genKey));
      }
      const { wave, heroes, id: id2 } = respawn(state, nextLevel, id);
      return { ...state, board, battle: { ...state.battle, level: nextLevel, wave, heroes, status: 'intro', recovering: false }, nextId: id2, pendingArea: null };
    }
    case A.RESOLVE_LOSS: {
      if (state.battle.status !== 'lost') return state;
      const level = Math.max(1, state.battle.level - 1);
      const { wave, heroes, id: id2 } = respawn(state, level, state.nextId);
      return { ...state, battle: { ...state.battle, level, wave, heroes, status: 'intro', recovering: true }, nextId: id2 };
    }
    case A.PAUSE_CHEST:
      return state.battle.status === 'fighting' ? { ...state, battle: { ...state.battle, status: 'chest' } } : state;
    case A.RESOLVE_CHEST:
      if (state.battle.status !== 'chest') return state;
      return { ...state, battle: { ...state.battle, status: 'fighting' } };
    case A.START_COMBAT:
      return state.battle.status === 'intro' ? { ...state, battle: { ...state.battle, status: 'fighting' } } : state;
    case A.CHALLENGE_NEXT: {
      if (state.battle.status === 'gate') return { ...state, battle: { ...state.battle, status: 'intro', recovering: false } };
      if (state.battle.status === 'fighting' && state.battle.recovering) {
        const level = state.battle.level + 1;
        const { wave, heroes, id: id2 } = respawn(state, level, state.nextId);
        return { ...state, battle: { ...state.battle, level, wave, heroes, status: 'intro', recovering: false }, nextId: id2, furthestLevel: Math.max(state.furthestLevel, level) };
      }
      return state;
    }
    case A.SWAP_HEROES: {
      const { a, b } = action;
      if (a === b) return state;
      const ia = state.order.indexOf(a); const ib = state.order.indexOf(b);
      if (ia < 0 || ib < 0) return state;
      const order = state.order.slice(); order[ia] = b; order[ib] = a;
      const squad = squadOf(order);
      const byId = Object.fromEntries(state.battle.heroes.map((h: any) => [h.id, h]));
      const statsFn = battleStatsFor(state.heroes, state.gear, state.ordersCompleted);
      const heroes = squad.map((hid: string) => byId[hid] || Battle.buildHeroes([hid], statsFn)[0]);
      return { ...state, order, battle: { ...state.battle, heroes } };
    }
    case A.SUMMON: {
      const banner = C.BANNERS[action.bannerId];
      if (!banner) return state;
      const ten = C.RUNTIME.tenPullCount;
      const count = action.count === ten ? ten : 1;
      const totalCost = count === ten ? banner.ten : banner.cost;
      if (state.coins < totalCost) return state;
      let id = state.nextId; let cidN = state.nextCid;
      let counters = { ...(state.pity[banner.id] || Gacha.initPity(banner)) };
      let heroes = state.heroes; let order = state.order;
      const results: any[] = [];
      for (let i = 0; i < count; i++) {
        const forced = Gacha.pityForce(banner, counters);
        const res = Gacha.pull(banner, rng, forced);
        counters = Gacha.advancePity(banner, counters, res.rarity);
        const c = `c${cidN++}`;
        heroes = { ...heroes, [c]: newCharacter(c, res.id, res.rarity) };
        order = [...order, c];
        results.push({ id: res.id, rarity: res.rarity, cid: c });
      }
      const squad = squadOf(order);
      const statsFn = battleStatsFor(heroes, state.gear, state.ordersCompleted);
      const byId = Object.fromEntries(state.battle.heroes.map((h: any) => [h.id, h]));
      const battle = { ...state.battle, heroes: squad.map((c: string) => byId[c] || Battle.buildHeroes([c], statsFn)[0]) };
      const pity = { ...state.pity, [banner.id]: counters };
      const fx = [...state.fx, { id: id++, type: 'gachaReveal', bannerId: banner.id, results }];
      return { ...state, coins: state.coins - totalCost, heroes, order, pity, battle, nextId: id, nextCid: cidN, fx, lastPull: results[results.length - 1] };
    }
    case A.ASCEND_HERO: {
      const src = state.heroes[action.id];
      if (!src) return state;
      const powOfCid = (c: string) => heroPower(state.heroes[c].hero, state.heroes[c], state.ordersCompleted, Gear.heroGearPower(state.gear, c));
      const sel = ascendSelection(state.heroes, src.hero, powOfCid);
      if (!sel) return state;
      const keep = state.heroes[sel.keepCid];
      if (!canAscendChar(keep)) return state;
      const heroes = { ...state.heroes, [sel.keepCid]: ascendChar(keep) };
      delete heroes[sel.sacrificeCid];
      const order = state.order.filter((c: string) => c !== sel.sacrificeCid);
      let gear = state.gear;
      if (Object.values(state.gear).some((g: any) => g.equippedTo === sel.sacrificeCid)) {
        gear = {};
        for (const k in state.gear) gear[k] = state.gear[k].equippedTo === sel.sacrificeCid ? { ...state.gear[k], equippedTo: null } : state.gear[k];
      }
      const squad = squadOf(order);
      const statsFn = battleStatsFor(heroes, gear, state.ordersCompleted);
      const byId = Object.fromEntries(state.battle.heroes.map((h: any) => [h.id, h]));
      const battleHeroes = squad.map((c: string) => { const live = byId[c]; if (!live) return Battle.buildHeroes([c], statsFn)[0]; return c === sel.keepCid ? rescaleHero(live, statsFn(c)) : live; });
      return { ...state, heroes, order, gear, battle: { ...state.battle, heroes: battleHeroes } };
    }
    case A.LEVEL_UP_HERO: {
      const h = state.heroes[action.id];
      if (!h || !Prog.canLevelHero(h, state.heroXp)) return state;
      const cost = Prog.heroLevelCost(h.level);
      const heroes = { ...state.heroes, [action.id]: { ...h, level: h.level + 1 } };
      let battle = state.battle;
      if (squadOf(state.order).includes(action.id)) {
        const statsFn = battleStatsFor(heroes, state.gear, state.ordersCompleted);
        battle = { ...battle, heroes: battle.heroes.map((bh: any) => (bh.id === action.id ? rescaleHero(bh, statsFn(bh.id)) : bh)) };
      }
      return { ...state, heroXp: state.heroXp - cost, heroes, battle };
    }
    case A.LEVEL_UP_HERO_MAX: {
      const h = state.heroes[action.id];
      if (!h) return state;
      const { level, spent } = Prog.levelUpHeroMax(h, state.heroXp);
      if (level === h.level) return state;
      const heroes = { ...state.heroes, [action.id]: { ...h, level } };
      let battle = state.battle;
      if (squadOf(state.order).includes(action.id)) {
        const statsFn = battleStatsFor(heroes, state.gear, state.ordersCompleted);
        battle = { ...battle, heroes: battle.heroes.map((bh: any) => (bh.id === action.id ? rescaleHero(bh, statsFn(bh.id)) : bh)) };
      }
      return { ...state, heroXp: state.heroXp - spent, heroes, battle };
    }
    case A.AUTO_EQUIP: {
      const ranked = [...state.order].sort((x: string, y: string) => heroPower(state.heroes[y].hero, state.heroes[y], state.ordersCompleted, 0) - heroPower(state.heroes[x].hero, state.heroes[x], state.ordersCompleted, 0));
      const gear = Gear.autoEquipAll(state.gear, ranked);
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.AUTO_LEVEL: {
      const { gear, xp } = Gear.autoLevelAll(state.gear, state.gearXp);
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.AUTO_HERO: {
      const hid = action.id; if (!state.heroes[hid]) return state;
      let gear = Gear.autoEquipHero(state.gear, hid);
      const res = Gear.autoLevelHero(gear, hid, state.gearXp); gear = res.gear;
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, gearXp: res.xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.LEVEL_GEAR: {
      const { gear, xp } = Gear.levelGear(state.gear, action.id, state.gearXp);
      if (gear === state.gear) return state;
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.EQUIP_ITEM: {
      const gear = Gear.equipItem(state.gear, action.gearId, action.heroId);
      if (gear === state.gear) return state;
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.LEVEL_ALL_ONE: {
      const { gear, xp } = Gear.levelAllHeroOnce(state.gear, action.id, state.gearXp);
      if (xp === state.gearXp) return state;
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.LEVEL_ALL_MAX: {
      const { gear, xp } = Gear.autoLevelHero(state.gear, action.id, state.gearXp);
      if (xp === state.gearXp) return state;
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.FUSE_GEAR: {
      const src = state.gear[action.id];
      if (!src || !Gear.canFuse(state.gear, action.id)) return state;
      const cost = Gear.fuseCost(src.rarity);
      if (state.coins < cost) return state;
      const gear = Gear.fuseGear(state.gear, action.id);
      if (gear === state.gear) return state;
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, coins: state.coins - cost, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.EQUIP_BEST: {
      const hid = action.id; if (!state.heroes[hid]) return state;
      const gear = Gear.autoEquipHero(state.gear, hid);
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.UPGRADE_HERO: {
      const hid = action.id; if (!state.heroes[hid]) return state;
      const { gear, xp } = Gear.autoLevelHero(state.gear, hid, state.gearXp);
      const statsFn = battleStatsFor(state.heroes, gear, state.ordersCompleted);
      return { ...state, gear, gearXp: xp, battle: { ...state.battle, heroes: rescaleBattle(state.battle, statsFn) } };
    }
    case A.RESET_GAME:
      return initState(action.now);
    case A.CLEAR_FX:
      return { ...state, fx: state.fx.filter((e: any) => !action.ids.includes(e.id)) };
    default:
      return state;
  }
};
