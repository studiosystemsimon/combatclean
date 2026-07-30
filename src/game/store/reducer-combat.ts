// === reducer slice: combat — level select, tick, limit break, win/loss/area/chest resolution ===
// Bodies moved verbatim from the former monolithic reducer switch. Orchestrates battle + map +
// crystals + progression (clearedLevel / area unlocks) + board generator awards; emits VFX on state.fx.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Board from '../board/board.ts';
import * as Battle from '../combat/battle.ts';
import * as Map from '../map/map.ts';
import { C } from '../content.ts';
import { rng } from '../sim-random.ts';
import { A } from './actions.ts';
import { respawn, winReward, rollWinCrystal, addCrystal } from './reducer-helpers.ts';

type S = any;
type Act = any;

export const combatHandlers: Record<string, (state: S, action: Act) => S> = {
  [A.SET_BATTLE_LEVEL]: (state, action) => {
    const frontier = state.clearedLevel + 1; // highest REACHED = the next level after your last cleared
    const target = Math.max(1, Math.min(Math.floor(action.level) || 1, frontier));
    // `intro` (start a zone from its first room) always (re)spawns — even if we're already on that level —
    // and opens on the ZONE-INTRO cinematic. A plain level-select is a no-op when already there.
    if (!action.intro && target === state.battle.level) return state;
    const { wave, heroes, id } = respawn(state, target, state.nextId);
    // Starting a zone BELOW the progression frontier is a REPLAY — remember the frontier so finishing
    // that zone warps back to it (RESOLVE_WIN). Starting the frontier zone itself is normal progression.
    const isReplay = !!action.intro && Map.zoneIndexForLevel(target) < Map.zoneIndexForLevel(frontier);
    const replayReturn = action.intro ? (isReplay ? frontier : null) : (state.replayReturn ?? null);
    // Map level-select is a NORMAL (losable) level — recovering (the can't-die shield)
    // is set ONLY by a loss (RESOLVE_LOSS), never by picking a level from the map.
    return { ...state, battle: { ...state.battle, level: target, wave, heroes, status: action.intro ? 'intro' : 'fighting', recovering: false, focusUid: null }, nextId: id, replayReturn };
  },
  [A.SET_FOCUS_TARGET]: (state, action) => {
    const focusUid = state.battle.focusUid === action.uid ? null : action.uid;
    return { ...state, battle: { ...state.battle, focusUid } };
  },
  [A.BATTLE_TICK]: (state, action) => {
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
    if (outcome === 'lose') {
      fx = [...fx, { id: id++, type: 'lose', level: battle.level }];
      // FTUE: arm the first-loss coachmark (the "go equip + level up" freeze). Monotonic; inert when off.
      const lostFlags = (state.flags && state.flags.ftueActive && !state.flags.ftueFirstLoss) ? { ...state.flags, ftueFirstLoss: true } : state.flags;
      return { ...state, flags: lostFlags, battle: { ...battle, status: 'lost' }, nextId: id, fx };
    }
    return { ...state, battle, nextId: id, fx };
  },
  [A.TAP_LIMIT]: (state, action) => {
    const { battle, outcome, fired, enemyDamage, enemyDeaths, heals, combo } = Battle.fireLimitBreak(state.battle, action.heroId);
    if (!fired.length) return state;
    let id = state.nextId;
    let fx = [...state.fx, { id: id++, type: 'limitBreak', heroes: fired, heroId: action.heroId, enemyDamage, enemyDeaths, heals }];
    if (combo) fx = [...fx, { id: id++, type: 'combo', uid: combo.uid, n: combo.n }];
    // FTUE (monotonic flags for the coachmarks): the first limit break, and specifically the alchemist's
    // AOE limit break (the recruited hero clearing the screen). Inert when the FTUE is off.
    let flags = state.flags;
    if (state.flags && state.flags.ftueActive) {
      const heroSlug = state.heroes[action.heroId] && state.heroes[action.heroId].hero;
      const set: any = {};
      if (!state.flags.ftueLimitFired) set.ftueLimitFired = true;
      if (C.FTUE && heroSlug === C.FTUE.firstPullHero && !state.flags.ftueAlchemistUsed) set.ftueAlchemistUsed = true;
      if (Object.keys(set).length) flags = { ...state.flags, ...set };
    }
    if (outcome === 'win') {
      const w = winReward(battle.level); const crystals = addCrystal(state.crystals, rollWinCrystal(battle.level));
      fx = [...fx, { id: id++, type: 'waveClear' }];
      return { ...state, flags, coins: state.coins + w.coins, heroXp: state.heroXp + w.heroXp, gearXp: state.gearXp + w.gearXp, crystals, battle: { ...battle, status: 'clearing' }, nextId: id, fx };
    }
    return { ...state, flags, battle, nextId: id, fx };
  },
  [A.SHOW_COMPLETE]: (state) => {
    if (state.battle.status !== 'clearing') return state;
    let id = state.nextId;
    const fx = [...state.fx, { id: id++, type: 'levelComplete', level: state.battle.level, ...winReward(state.battle.level) }];
    return { ...state, battle: { ...state.battle, status: 'won' }, nextId: id, fx };
  },
  [A.RESOLVE_WIN]: (state) => {
    if (state.battle.status !== 'won') return state;
    // A recovering win no longer loops the same level — it advances to the next level
    // (a real, losable attempt again) via the normal path below, which clears recovering.
    const nextLevel = state.battle.level + 1;
    // AREA COMPLETE: beating the last level of a zone crosses into the next area. On the FIRST clear
    // (new furthest progress) STOP and gate — grant this area's generator unlocks, then wait for the
    // player to accept the popup (A.ACCEPT_AREA_COMPLETE) before the next area is entered.
    const fromZone = Map.zoneIndexForLevel(state.battle.level);
    const toZone = Map.zoneIndexForLevel(nextLevel);
    // REPLAY return: when replaying an EARLIER zone (replayReturn set) and you cross its boundary
    // (that area is finished), warp back to the saved progression frontier instead of advancing linearly.
    if (state.replayReturn != null && toZone > fromZone) {
      const back = Math.max(1, Math.min(state.replayReturn, state.clearedLevel + 1));
      const { wave, heroes, id: idR } = respawn(state, back, state.nextId);
      return { ...state, battle: { ...state.battle, level: back, wave, heroes, status: 'fighting', recovering: false, focusUid: null }, nextId: idR, replayReturn: null };
    }
    if (toZone > fromZone && state.battle.level > state.clearedLevel) {
      const zone = C.ZONES[fromZone];
      // Zone-completion generator award (hardcoded per zone, rotating magic→blade→range at fixed levels).
      const rewards = ((zone && zone.rewardGenerators) || []) as Array<{ generatorKey: string; level: number }>;
      // A genuinely-NEW generator type also joins the unlocked set (order eligibility + boot placement);
      // an already-unlocked type is still AWARDED below as a mergeable duplicate.
      const newTypes = rewards.map((r) => r.generatorKey).filter((k: string) => !state.unlockedGenerators.includes(k));
      const unlockedGenerators = newTypes.length ? [...state.unlockedGenerators, ...newTypes] : state.unlockedGenerators;
      // Board-award cinematic: plan each generator's LANDING CELL now via the shared add-tile rule
      // (empty → else replace the lowest active item), so the appear→fly→land cinematic flies to the
      // exact cell ACCEPT will drop it on. Sequential picks give multiple awards distinct cells.
      // `reward` = the boss-clear reward, for the synopsis card.
      let id = state.nextId;
      let workBoard = state.board;
      const placements: { genKey: string; level: number; cell: number }[] = [];
      const fx = [...state.fx];
      for (const r of rewards) {
        const cell = Board.addTileIndex(workBoard);
        if (cell < 0) continue; // board is all generators + cobwebs — nowhere to add
        placements.push({ genKey: r.generatorKey, level: r.level, cell });
        workBoard = Board.withCell(workBoard, cell, Board.makeGenerator(0, r.generatorKey, r.level)); // reserve the cell for the next pick (id irrelevant; discarded)
        fx.push({ id: id++, type: 'generatorUnlock', genKey: r.generatorKey, level: r.level, cell });
      }
      return {
        ...state, unlockedGenerators, fx, nextId: id,
        clearedLevel: Math.max(state.clearedLevel, state.battle.level),
        battle: { ...state.battle, status: 'areaComplete', recovering: false },
        // `unlocked` = every AWARDED key (drives the area-complete popup + its nav trigger — not just new types).
        pendingArea: { zoneIdx: fromZone, nextLevel, unlocked: rewards.map((r) => r.generatorKey), placements, reward: winReward(state.battle.level) },
      };
    }
    if (Map.isBossLevel(nextLevel)) {
      const { wave, heroes, id: id2 } = respawn(state, nextLevel, state.nextId);
      return { ...state, battle: { ...state.battle, level: nextLevel, wave, heroes, status: 'gate', recovering: false }, nextId: id2, clearedLevel: Math.max(state.clearedLevel, state.battle.level) };
    }
    const { wave, heroes, id: id2 } = respawn(state, nextLevel, state.nextId);
    // FTUE: arm the predetermined summon when the player reaches the configured level ("things are
    // getting tough — hire a hero"). Once; consumed + disarmed by SUMMON. Inert when off / already pulled.
    const armPull = !!(state.flags && state.flags.ftueActive && !state.flags.ftuePulled && C.FTUE && nextLevel === C.FTUE.summonAtLevel);
    // FTUE: unlock special orders "later in the run" — once the player reaches specialsUnlockAtLevel.
    const unlockSpecials = !!(state.flags && state.flags.ftueActive && !state.flags.specialOrders && C.FTUE && nextLevel >= C.FTUE.specialsUnlockAtLevel);
    const flags = (armPull || unlockSpecials)
      ? { ...state.flags, ...(armPull ? { ftueFirstPull: true } : {}), ...(unlockSpecials ? { specialOrders: true } : {}) }
      : state.flags;
    return { ...state, flags, battle: { ...state.battle, level: nextLevel, wave, heroes, status: 'intro', recovering: false }, nextId: id2, clearedLevel: Math.max(state.clearedLevel, state.battle.level) };
  },
  [A.ACCEPT_AREA_COMPLETE]: (state) => {
    if (state.battle.status !== 'areaComplete' || !state.pendingArea) return state;
    const { nextLevel, unlocked, placements } = state.pendingArea;
    let id = state.nextId;
    let board = state.board;
    // Drop each newly-unlocked generator via the shared add-tile rule. Prefer the cell PLANNED at win
    // (so it matches where the cinematic flew); if that cell was since filled by a generator/cobweb,
    // re-resolve with addTileToBoard. Falls back to a fresh resolve when no plan exists.
    const plan = (placements && placements.length) ? placements : (unlocked || []).map((genKey: string) => ({ genKey, level: 0, cell: -1 }));
    for (const p of plan) {
      const cur = p.cell >= 0 ? board[p.cell] : null;
      const planOk = p.cell >= 0 && !(cur && (cur.kind === 'generator' || (cur.kind === 'item' && cur.locked)));
      board = planOk
        ? Board.withCell(board, p.cell, Board.makeGenerator(id++, p.genKey, p.level))
        : Board.addTileToBoard(board, Board.makeGenerator(id++, p.genKey, p.level));
    }
    const { wave, heroes, id: id2 } = respawn(state, nextLevel, id);
    return { ...state, board, battle: { ...state.battle, level: nextLevel, wave, heroes, status: 'intro', recovering: false }, nextId: id2, pendingArea: null };
  },
  [A.RESOLVE_LOSS]: (state) => {
    if (state.battle.status !== 'lost') return state;
    const level = Math.max(1, state.battle.level - 1);
    const { wave, heroes, id: id2 } = respawn(state, level, state.nextId);
    return { ...state, battle: { ...state.battle, level, wave, heroes, status: 'intro', recovering: true }, nextId: id2 };
  },
  [A.PAUSE_CHEST]: (state) =>
    state.battle.status === 'fighting' ? { ...state, battle: { ...state.battle, status: 'chest' } } : state,
  [A.RESOLVE_CHEST]: (state) => {
    if (state.battle.status !== 'chest') return state;
    return { ...state, battle: { ...state.battle, status: 'fighting' } };
  },
  [A.START_COMBAT]: (state) =>
    state.battle.status === 'intro' ? { ...state, battle: { ...state.battle, status: 'fighting' } } : state,
  [A.CHALLENGE_NEXT]: (state) => {
    if (state.battle.status === 'gate') return { ...state, battle: { ...state.battle, status: 'intro', recovering: false } };
    if (state.battle.status === 'fighting' && state.battle.recovering) {
      const level = state.battle.level + 1;
      const { wave, heroes, id: id2 } = respawn(state, level, state.nextId);
      return { ...state, battle: { ...state.battle, level, wave, heroes, status: 'intro', recovering: false }, nextId: id2, clearedLevel: Math.max(state.clearedLevel, state.battle.level) };
    }
    return state;
  },
};
