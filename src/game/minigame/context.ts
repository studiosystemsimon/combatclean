// === minigame context + selector (model) — the STANDARD input every minigame receives ===
// A minigame launch is `{ id, input }`. The `input` is one standard, data-only snapshot passed to EVERY
// minigame (each uses what it needs): the current zone (enemies + scenery-by-level) and the current squad.
// The `id` is picked at RANDOM from the data-driven pool (C.MINIGAME.pool) using the seeded sim rng, so
// the choice is deterministic/replayable. Model-only: reads content C + state + rng; NO view/asset imports
// (ids/slugs/numbers only — the view resolves art via the barrels: heroAsset / enemy.<slug> / zoneForLevel).
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Map from '../map/map.ts';
import { C } from '../content.ts';
import { squadOf } from '../store/reducer-helpers.ts';

type S = any;

// The standard snapshot. Data-only: enemy/hero SLUGS + numbers; the view resolves sprites + zone scenery.
export function buildMinigameContext(state: S, source = 'special-merge') {
  const level = state?.battle?.level ?? C.BATTLE.startLevel;
  const zone = Map.zoneForLevel(level);
  // Enemies + boss come from the CURRENT ZONE's pool (the same pool buildWave draws from).
  const enemies = (zone.enemyPool || [])
    .map((slug: string) => { const e = C.ENEMY_BY_ID[slug]; return e ? { slug, hpMul: e.hpMul, atkMul: e.atkMul, boss: !!e.boss } : null; })
    .filter(Boolean);
  const bossSlug = zone.bossId || null;
  const accompliceSlug = zone.accompliceId || null; // the zone's caster/accomplice → the shooter's back-row sniper sprite
  // Heroes = the player's CURRENT SQUAD (never zone-scoped); pair each cid with its live battle stats.
  const byId: Record<string, any> = Object.fromEntries((state?.battle?.heroes || []).map((h: any) => [h.id, h]));
  const heroes = squadOf(state?.order || [])
    .map((cid: string) => { const h = byId[cid]; return h ? { id: cid, hero: h.hero, atk: h.atk, maxHp: h.maxHp } : null; })
    .filter(Boolean);
  // `level` lets the view resolve zone scenery (zoneForLevel → keyArt + biome); zoneId is informational.
  return { source, level, zoneId: zone.id, enemies, bossSlug, accompliceSlug, heroes };
}

// Random pick from the data-driven pool via the seeded rng (same pattern as buildWave/gacha). Any REAL
// minigame supersedes the fallback/template: pick at random among the non-fallback pool ids, and only
// fall back to fallbackId when the pool holds nothing else.
export function pickMinigameId(rng: () => number): string {
  const { pool, fallbackId } = C.MINIGAME;
  const real = pool.filter((id: string) => id !== fallbackId);
  const choices = real.length ? real : pool;
  return choices[Math.floor(rng() * choices.length)] || fallbackId;
}

// The full launch payload: a random pooled minigame + the standard context. Used by the special-merge
// transition and the dev quick-launch.
export function buildMinigameLaunch(state: S, rng: () => number, source = 'special-merge') {
  return { id: pickMinigameId(rng), input: buildMinigameContext(state, source) };
}
