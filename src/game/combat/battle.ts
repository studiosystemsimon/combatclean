// === combat — the autobattler sim (ported from MergeCombat model/battle.js; PURE, reads content C + injected rng) ===
// 5 heroes vs a wave. Basic attacks on per-hero cadence; NORMAL abilities auto-fire on charge; LIMIT
// BREAKS charge from completed orders + fire on tap. Heroes focus/spill; enemies hit random living
// heroes; bosses telegraph→special / trickle-heal / raise minions. Returns outcome + event arrays
// (the orchestrator dispatches signals from them). Sim time == real time (dt in real ms). Faithful.
import { C } from '../content.ts';
import type { Rng } from '../rng.ts';
import { hash32 } from '../rng.ts';
import type { BattleState, BattleHero, Enemy } from '../types.ts';
import { heroDef } from '../heroes/heroes.ts';
import { zoneForLevel, isBossLevel, isEliteLevel, isRestLevel } from '../map/map.ts';

const mkEnemy = (arch: any, hp: number, atk: number): Enemy => ({
  arch: arch.id, asset: `enemy.${arch.id}`, name: arch.id, uid: 0,
  hp: Math.max(1, Math.round(hp)), maxHp: Math.max(1, Math.round(hp)), atk: Math.max(1, Math.round(atk)),
});

export const buildWave = (level: number, rng: Rng, nextUid: () => number): Enemy[] => {
  const S = C.LEVEL_SCALING;
  level = Math.max(1, Math.floor(level) || 1);
  const zone = zoneForLevel(level);
  const elite = isEliteLevel(level);
  const rest = isRestLevel(level);
  const eHp = elite ? C.NODE.eliteHpMul : rest ? C.NODE.restHpMul : 1;
  const eAtk = elite ? C.NODE.eliteAtkMul : rest ? C.NODE.restAtkMul : 1;
  const hpAt = (mul: number) => S.hpBase * Math.pow(S.hpGrowth, level - 1) * mul * eHp;
  const atkAt = (mul: number) => S.atkBase * Math.pow(S.atkGrowth, level - 1) * mul * eAtk;
  const uid = (e: Enemy): Enemy => ({ ...e, uid: nextUid() });

  if (isBossLevel(level)) {
    const bossArch = C.ENEMY_BY_ID[zone.bossId] || C.ENEMY_ARCHETYPES[C.ENEMY_ARCHETYPES.length - 1];
    const boss = uid({ ...mkEnemy(bossArch, hpAt(bossArch.hpMul) * S.bossHpMul * S.bossStepMul, atkAt(bossArch.atkMul) * S.bossStepMul), specialMs: 0, specialCount: 0, isBoss: true });
    const accArch = C.ENEMY_BY_ID[zone.accompliceId] || C.ENEMY_BY_ID[S.bossAccompliceId] || C.ENEMY_ARCHETYPES[0];
    const mkAcc = () => uid({ ...mkEnemy(accArch, hpAt(accArch.hpMul) * S.bossAccompliceMul, atkAt(accArch.atkMul) * S.bossAccompliceMul), accomplice: true });
    return [mkAcc(), boss, mkAcc()];
  }
  const count0 = Math.min(S.maxWave, S.enemiesBase + Math.floor((level - 1) / S.enemyStepLevels) * S.enemiesPerStep);
  const count = rest ? Math.min(count0, C.NODE.restCount) : count0;
  const pool = zone.enemyPool.map((id: string) => C.ENEMY_BY_ID[id]).filter(Boolean);
  const src = pool.length ? pool : C.ENEMY_ARCHETYPES.slice(0, 5);
  const wave: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const a = src[Math.floor(rng() * src.length)];
    wave.push(uid(mkEnemy(a, hpAt(a.hpMul), atkAt(a.atkMul))));
  }
  return wave;
};

export const heroAtkMs = (hero: string, seed: string | number) => {
  const base = (C.BATTLE.attackMsByWeapon && C.BATTLE.attackMsByWeapon[heroDef(hero).weapon]) || C.BATTLE.defaultAttackMs;
  return base + (hash32(seed != null ? seed : hero) % C.BATTLE.attackJitterSteps) * C.BATTLE.attackJitterMs;
};

export const buildHeroes = (squad: string[], statsFn: (cid: string) => { atk: number; maxHp: number; abilityMul: number; hero: string }): BattleHero[] =>
  squad.map((cid) => {
    const s = statsFn(cid);
    return { id: cid, hero: s.hero, hp: s.maxHp, maxHp: s.maxHp, atk: s.atk, abilityMul: s.abilityMul != null ? s.abilityMul : 1, normalMs: 0, basicMs: hash32(cid) % heroAtkMs(s.hero, cid), limitEnergy: 0 };
  });

// ── damage helpers (pure) ──
const focusDamage = (units: Enemy[], total: number, focusUid: number | null = null): Enemy[] => {
  let dmg = total;
  const next = units.map((u) => ({ ...u }));
  const order: number[] = [];
  if (focusUid != null) { const fi = next.findIndex((u) => u.uid === focusUid && u.hp > 0); if (fi >= 0) order.push(fi); }
  for (let i = 0; i < next.length; i++) if (!order.includes(i)) order.push(i);
  for (const i of order) { if (dmg <= 0) break; const u = next[i]; if (u.hp <= 0) continue; const applied = Math.min(u.hp, dmg); dmg -= applied; u.hp -= applied; }
  return next;
};
const aoeDamage = (units: Enemy[], per: number): Enemy[] => (per <= 0 ? units : units.map((u) => (u.hp <= 0 ? u : { ...u, hp: Math.max(0, u.hp - per) })));
const allDead = (units: Array<{ hp: number }>) => units.every((u) => u.hp <= 0);
const survivingFocus = (focusUid: number | null | undefined, wave: Enemy[]) => (focusUid != null && wave.some((e) => e.uid === focusUid && e.hp > 0)) ? focusUid : null;
const healParty = (heroes: BattleHero[], frac: number) => frac <= 0 ? heroes : heroes.map((h) => (h.hp <= 0 ? h : { ...h, hp: Math.min(h.maxHp, h.hp + Math.round(h.maxHp * frac)) }));
const applyAbilityEffect = (effect: any, atk: number, acc: { focus: number; aoe: number; healFrac: number }, abilityMul = 1) => {
  if (effect.type === 'burst') acc.focus += Math.round(atk * effect.mult * abilityMul);
  else if (effect.type === 'aoe') acc.aoe += Math.round(atk * effect.mult * abilityMul);
  else if (effect.type === 'heal') acc.healFrac += effect.frac * abilityMul;
};
const enemiesAttack = (heroes: BattleHero[], wave: Enemy[], dtMs: number, rng: Rng) => {
  const next = heroes.map((h) => ({ ...h }));
  const hits: Array<{ enemyUid: number; heroId: string; dmg: number }> = [];
  const interval = C.BATTLE.enemyAttackMs || C.BATTLE.defaultAttackMs;
  for (const e of wave) {
    if (e.hp <= 0) continue;
    if (e.atkMs == null) e.atkMs = hash32(e.uid) % interval;
    e.atkMs += dtMs;
    if (e.atkMs < interval) continue;
    e.atkMs -= interval;
    const alive: number[] = [];
    for (let i = 0; i < next.length; i++) if (next[i].hp > 0) alive.push(i);
    if (!alive.length) break;
    const idx = alive[Math.floor(rng() * alive.length)];
    next[idx].hp = Math.max(0, next[idx].hp - e.atk);
    hits.push({ enemyUid: e.uid, heroId: next[idx].id, dmg: e.atk });
  }
  return { heroes: next, hits };
};

export interface TickResult {
  battle: BattleState; outcome: 'win' | 'lose' | null;
  firedNormals: string[]; firedBasics: Array<{ id: string; weapon: string; dmg: number; crit: boolean }>;
  enemyHits: Array<{ enemyUid: number; heroId: string; dmg: number }>;
  bossSpecial: { uid: number; heroIds: string[]; dmg: number } | null; bossTelegraph: { uid: number } | null;
  bossHeal: { uid: number; amount: number } | null; bossRaise: { uid: number; raised: number[] } | null;
  enemyDamage: Array<{ uid: number; amount: number }>; enemyDeaths: number[];
  heals: Array<{ heroId: string; amount: number }>; crit: boolean; combo: { uid: number; n: number } | null;
}

export const battleTick = (battle: BattleState, dtMs: number, rng: Rng): TickResult => {
  const empty: TickResult = { battle, outcome: null, firedNormals: [], firedBasics: [], enemyHits: [], bossSpecial: null, bossTelegraph: null, bossHeal: null, bossRaise: null, enemyDamage: [], enemyDeaths: [], heals: [], crit: false, combo: null };
  if (battle.status !== 'fighting') return empty;
  let heroes = battle.heroes.map((h) => ({ ...h }));
  let wave = battle.wave.map((e) => ({ ...e }));
  const firedNormals: string[] = [];
  const acc = { focus: 0, aoe: 0, healFrac: 0 };
  let bossSpecial: TickResult['bossSpecial'] = null, bossTelegraph: TickResult['bossTelegraph'] = null, bossHeal: TickResult['bossHeal'] = null, bossRaise: TickResult['bossRaise'] = null;
  let crit = false;
  const firedBasics: TickResult['firedBasics'] = [];
  for (const h of heroes) {
    if (h.hp <= 0) continue;
    h.normalMs += dtMs;
    h.basicMs = (h.basicMs || 0) + dtMs;
    const atkMs = heroAtkMs(h.hero, h.id);
    if (h.basicMs >= atkMs) {
      h.basicMs -= atkMs;
      const isCrit = rng() < C.BATTLE.critChance;
      const dmg = Math.max(1, Math.round(h.atk * (isCrit ? C.BATTLE.critMult : 1)));
      acc.focus += dmg; if (isCrit) crit = true;
      firedBasics.push({ id: h.id, weapon: heroDef(h.hero).weapon, dmg, crit: isCrit });
    }
    const nrm = heroDef(h.hero).normal;
    if (h.normalMs >= nrm.chargeMs) { h.normalMs = 0; firedNormals.push(h.id); applyAbilityEffect(nrm.effect, h.atk, acc, h.abilityMul || 1); }
  }

  let comboUid = battle.comboUid ?? null, comboN = battle.comboN ?? 0, combo: TickResult['combo'] = null;
  if (firedNormals.length > 0) {
    const focusAlive = battle.focusUid != null && wave.some((e) => e.uid === battle.focusUid && e.hp > 0);
    const tEnemy = focusAlive ? wave.find((e) => e.uid === battle.focusUid) : wave.find((e) => e.hp > 0);
    if (tEnemy) { if (tEnemy.uid === comboUid) comboN += 1; else { comboUid = tEnemy.uid; comboN = 1; } if (comboN >= C.BATTLE.comboMin) combo = { uid: comboUid as number, n: comboN }; }
  }

  const heroPre = new Map(heroes.map((h) => [h.id, h.hp]));
  heroes = healParty(heroes, acc.healFrac);
  const heals = heroes.filter((h) => h.hp > (heroPre.get(h.id) as number)).map((h) => ({ heroId: h.id, amount: h.hp - (heroPre.get(h.id) as number) }));

  const wavePre = new Map(wave.map((e) => [e.uid, e.hp]));
  wave = aoeDamage(wave, acc.aoe);
  wave = focusDamage(wave, acc.focus, battle.focusUid ?? null);
  const enemyDamage = wave.filter((e) => (wavePre.get(e.uid) as number) > e.hp).map((e) => ({ uid: e.uid, amount: (wavePre.get(e.uid) as number) - e.hp }));
  const enemyDeaths = wave.filter((e) => (wavePre.get(e.uid) || 0) > 0 && e.hp <= 0).map((e) => e.uid);

  if (allDead(wave)) return { ...empty, battle: { ...battle, heroes, wave, comboUid, comboN, focusUid: survivingFocus(battle.focusUid, wave) }, outcome: 'win', firedNormals, firedBasics, enemyDamage, enemyDeaths, heals, crit, combo };

  const S = C.LEVEL_SCALING;
  const boss = wave.find((e) => e.specialMs !== undefined && e.hp > 0);
  if (boss) {
    const accAlive = wave.some((e) => e.accomplice && e.hp > 0);
    if (accAlive && boss.hp < boss.maxHp) {
      boss.healMs = (boss.healMs || 0) + dtMs;
      if (boss.healMs >= S.bossHealMs) { boss.healMs -= S.bossHealMs; const before = boss.hp; boss.hp = Math.min(boss.maxHp, boss.hp + Math.max(1, Math.round(boss.maxHp * S.bossHealFrac))); if (boss.hp > before) bossHeal = { uid: boss.uid, amount: boss.hp - before }; }
    }
    boss.specialMs = (boss.specialMs || 0) + dtMs;
    const warnAt = S.bossSpecialMs - S.bossTelegraphMs;
    if (!boss.telegraphed && boss.specialMs >= warnAt && boss.specialMs < S.bossSpecialMs) { boss.telegraphed = true; bossTelegraph = { uid: boss.uid }; }
    if (boss.specialMs >= S.bossSpecialMs) {
      boss.specialMs = 0; boss.telegraphed = false; boss.specialCount = (boss.specialCount || 0) + 1;
      if (boss.specialCount % S.bossRaiseEvery === 0) {
        const raised: number[] = [];
        for (const e of wave) if (e.accomplice && e.hp <= 0) { e.hp = Math.max(1, Math.round(e.maxHp * S.bossRaiseFrac)); raised.push(e.uid); }
        bossRaise = { uid: boss.uid, raised };
      } else {
        const dmg = Math.round(boss.atk * S.bossSpecialMult); const hitIds: string[] = [];
        for (const h of heroes) { if (h.hp <= 0) continue; h.hp = Math.max(0, h.hp - dmg); hitIds.push(h.id); }
        bossSpecial = { uid: boss.uid, heroIds: hitIds, dmg };
      }
    }
  }

  const { heroes: heroesAfter, hits } = enemiesAttack(heroes, wave, dtMs, rng);
  heroes = heroesAfter;
  // While recovering (a post-loss retry / map replay) heroes CANNOT die — floor HP at 1
  // so the level can't be lost. They still take hits (bars sit low) and keep fighting,
  // so the wave clears and RESOLVE_WIN advances to the next level.
  if (battle.recovering) heroes = heroes.map((h) => (h.hp < 1 ? { ...h, hp: 1 } : h));
  const outcome = allDead(heroes) ? 'lose' : null;
  return { ...empty, battle: { ...battle, heroes, wave, comboUid, comboN, focusUid: survivingFocus(battle.focusUid, wave) }, outcome, firedNormals, firedBasics, enemyHits: hits, bossSpecial, bossTelegraph, bossHeal, bossRaise, enemyDamage, enemyDeaths, heals, crit, combo };
};

export const fireLimitBreak = (battle: BattleState, cid: string) => {
  if (battle.status !== 'fighting') return { battle, outcome: null as 'win' | null, fired: [] as string[] };
  const idx = battle.heroes.findIndex((h) => h.id === cid);
  if (idx < 0) return { battle, outcome: null, fired: [] };
  const h0 = battle.heroes[idx];
  const lim = heroDef(h0.hero).limit;
  if (h0.hp <= 0 || (h0.limitEnergy || 0) < limitEnergyToCharge(h0.hero)) return { battle, outcome: null, fired: [] };
  let heroes = battle.heroes.map((h) => ({ ...h }));
  let wave = battle.wave.map((e) => ({ ...e }));
  const acc = { focus: 0, aoe: 0, healFrac: 0 };
  heroes[idx].limitEnergy = 0;
  applyAbilityEffect(lim.effect, heroes[idx].atk, acc, heroes[idx].abilityMul || 1);
  let comboUid = battle.comboUid ?? null, comboN = battle.comboN ?? 0, combo: TickResult['combo'] = null;
  {
    const focusAlive = battle.focusUid != null && wave.some((e) => e.uid === battle.focusUid && e.hp > 0);
    const tEnemy = focusAlive ? wave.find((e) => e.uid === battle.focusUid) : wave.find((e) => e.hp > 0);
    if (tEnemy) { if (tEnemy.uid === comboUid) comboN += 1; else { comboUid = tEnemy.uid; comboN = 1; } if (comboN >= C.BATTLE.comboMin) combo = { uid: comboUid as number, n: comboN }; }
  }
  const heroPre = new Map(heroes.map((h) => [h.id, h.hp]));
  heroes = healParty(heroes, acc.healFrac);
  const heals = heroes.filter((h) => h.hp > (heroPre.get(h.id) as number)).map((h) => ({ heroId: h.id, amount: h.hp - (heroPre.get(h.id) as number) }));
  const wavePre = new Map(wave.map((e) => [e.uid, e.hp]));
  wave = aoeDamage(wave, acc.aoe);
  wave = focusDamage(wave, acc.focus, battle.focusUid ?? null);
  const enemyDamage = wave.filter((e) => (wavePre.get(e.uid) as number) > e.hp).map((e) => ({ uid: e.uid, amount: (wavePre.get(e.uid) as number) - e.hp }));
  const enemyDeaths = wave.filter((e) => (wavePre.get(e.uid) || 0) > 0 && e.hp <= 0).map((e) => e.uid);
  const outcome = allDead(wave) ? 'win' as const : null;
  return { battle: { ...battle, heroes, wave, comboUid, comboN, focusUid: survivingFocus(battle.focusUid, wave) }, outcome, fired: [cid], enemyDamage, enemyDeaths, heals, combo };
};

// ── selectors ──
// Limit CAPACITY (energy needed to charge) — per hero from limit.orders (data), else the battle default.
export const limitEnergyToCharge = (hero: string) => heroDef(hero).limit.orders || C.BATTLE.defaultLimitOrders;
const capLimit = (h: BattleHero, v: number) => Math.min(limitEnergyToCharge(h.hero), v);
export const isLimitReady = (h: BattleHero) => h.hp > 0 && (h.limitEnergy || 0) >= limitEnergyToCharge(h.hero);
export const readyLimitCount = (battle: BattleState) => battle.heroes.filter(isLimitReady).length;
// Completing an ORDER grants every living hero the equivalent merge energy + a small bonus.
export const grantOrderEnergy = (heroes: BattleHero[]): BattleHero[] => {
  const le = C.BATTLE.limitEnergy; const add = le.mergeBase + le.orderBonus;
  return heroes.map((h) => (h.hp > 0 ? { ...h, limitEnergy: capLimit(h, (h.limitEnergy || 0) + add) } : h));
};
// Limit POTION reward (from a potion order): fills a fraction (potionFrac; 1.0 = full) of every living
// hero's limit charge — a big slug of limit energy, unlike the small drip from a normal order/merge.
export const grantLimitPotion = (heroes: BattleHero[], frac: number): BattleHero[] =>
  heroes.map((h) => (h.hp > 0 ? { ...h, limitEnergy: capLimit(h, (h.limitEnergy || 0) + frac * limitEnergyToCharge(h.hero)) } : h));
// A MERGE whose RESULT tier >= mergeMinTier grants proportional energy to the N lowest-charged living heroes;
// both N (mergeTargets) and the per-hero amount (mergeBase + mergePerTier·tiersAbove) scale with the tier.
export const grantMergeEnergy = (heroes: BattleHero[], tier: number): BattleHero[] => {
  const le = C.BATTLE.limitEnergy;
  if (tier < le.mergeMinTier) return heroes;
  const off = tier - le.mergeMinTier;
  const amount = le.mergeBase + le.mergePerTier * off;
  const n = le.mergeTargets[Math.min(off, le.mergeTargets.length - 1)] || 0;
  const picked = new Set(
    heroes.map((h, i) => ({ h, i }))
      .filter((x) => x.h.hp > 0 && (x.h.limitEnergy || 0) < limitEnergyToCharge(x.h.hero))
      .sort((a, b) => (a.h.limitEnergy || 0) - (b.h.limitEnergy || 0))
      .slice(0, n)
      .map((x) => x.i),
  );
  return heroes.map((h, i) => (picked.has(i) ? { ...h, limitEnergy: capLimit(h, (h.limitEnergy || 0) + amount) } : h));
};
export const normalChargeFrac = (h: BattleHero) => Math.min(1, h.normalMs / heroDef(h.hero).normal.chargeMs);
export const limitChargeFrac = (h: BattleHero) => Math.min(1, (h.limitEnergy || 0) / limitEnergyToCharge(h.hero));
export const frontEnemyUid = (battle: BattleState) => { const e = battle.wave.find((x) => x.hp > 0); return e ? e.uid : null; };
export const effectiveTargetUid = (battle: BattleState) => {
  if (battle.focusUid != null && battle.wave.some((x) => x.uid === battle.focusUid && x.hp > 0)) return battle.focusUid;
  return frontEnemyUid(battle);
};
