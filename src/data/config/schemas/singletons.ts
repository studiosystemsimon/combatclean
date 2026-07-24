// === singleton-category schemas ===
//
// Game-global CONTENT-tier tuning objects, validated by the SAME engine as the per-entity categories.
// Each lives in `src/data/config/game/_<name>.json`, folded into the bundle by the vite compose hook.
// EVERY multiplier/scalar is an exposed, named field here (Hard rule: no hidden multipliers) — the sim
// reads them by name. Distinct from src/data/store.ts, which owns sim/view live-HMR globals.
import { z } from 'zod';
import { configRef, stringConfigRef, configRecord } from '@bishop/config-registry';

const num = z.number();
const int = z.number().int();

// board — grid dims + squad size + the fresh-account start layout.
export const zBoardConfig = z.object({
  cols: int, rows: int,
  selectedSlots: int.describe('Squad size = first N of the owned order.'),
  drag: z.object({
    liftFactor: num.describe('While dragging, the icon lifts up by this × the tile height so a thumb never covers it.'),
    liftScale: num.describe('A held item scales to this × its resting size (1 = no change).'),
    easeMs: num.describe('Duration (ms) of the lift ease-in on grab / ease-out on release.'),
    easeCurve: z.string().describe('CSS timing-function for the lift ease (natural settle, no bounce).'),
  }).strict().describe('Held-tile lift so the dragged icon stays visible above the finger/thumb.'),
  startLayout: z.object({
    generators: z.array(stringConfigRef('generators', 'key')).describe('Generators placed on a fresh board (→ generators.key).'),
    seedItems: z.array(z.object({
      chain: stringConfigRef('chains', 'key'), level: int, cell: int, locked: z.boolean().optional(),
    }).strict()),
  }).strict(),
}).strict();

// energy — the regenerating energy wallet knobs.
export const zEnergyConfig = z.object({
  max: int, start: int, regenMs: num, regenAmount: int,
}).strict();

// battle — the combat loop + cadence + reward knobs.
export const zBattleConfig = z.object({
  tickMs: num.describe('Combat tick = real interval AND simulated dt (no time-stretch/rate mul).'),
  attackMsByWeapon: configRecord('chains', 'key', num).describe('Per-weapon basic-attack cadence (ms), keyed by chain/weapon.'),
  enemyAttackMs: num,
  attackJitterSteps: int, attackJitterMs: num,
  critChance: num, critMult: num, comboMin: int,
  startLevel: int, orderPowerBonus: num.describe('+fraction to all heroes per completed order.'),
  clearPauseMs: num, loseBannerMs: num, completeBannerMs: num, chestFallbackMs: num, introFallbackMs: num,
  reward: z.object({
    heroXpBase: num, heroXpPerLevel: num, gearXpBase: num, gearXpPerLevel: num, coinsBase: num, coinsPerLevel: num,
  }).strict(),
}).strict();

// heroCombat — the exposed hero stat-formula weights (gear→stat, power metric).
export const zHeroCombatConfig = z.object({
  gearAtkWeight: num, gearHpWeight: num, powerAtkWeight: num, powerHpDivisor: num,
}).strict();

// levelScaling — enemy HP/ATK growth + boss + accomplice knobs (all exposed).
export const zLevelScalingConfig = z.object({
  hpBase: num, hpGrowth: num, atkBase: num, atkGrowth: num,
  enemiesBase: int, enemiesPerStep: int, enemyStepLevels: int, maxWave: int,
  bossEvery: int, bossHpMul: num, bossStepMul: num,
  bossSpecialMs: num, bossTelegraphMs: num, bossSpecialMult: num,
  bossAccompliceConfigId: configRef('enemies').describe('The accomplice archetype flanking/raised by the boss (→ enemies).'),
  bossAccompliceMul: num, bossHealFrac: num, bossHealMs: num, bossRaiseEvery: int, bossRaiseFrac: num,
}).strict();

// node — per-position node types within a zone + their reward/difficulty muls.
export const zNodeConfig = z.object({
  layout: z.record(z.string(), z.enum(['treasure', 'elite', 'rest'])).describe('Node type by 1-based position within a zone (unlisted = combat; last = boss).'),
  rewardMul: z.object({ combat: num, treasure: num, elite: num, rest: num, boss: num }).strict(),
  eliteHpMul: num, eliteAtkMul: num, restCount: int, restHpMul: num, restAtkMul: num,
}).strict();

// afk — idle income (per-hour + per-zone-index terms).
export const zAfkConfig = z.object({
  maxOfflineMs: num, minReportMs: num,
  coinsPerHr: num, coinsPerZone: num, heroXpPerHr: num, heroXpPerZone: num, gearXpPerHr: num, gearXpPerZone: num,
}).strict();

export const zCrystalDropConfig = z.object({ dropChance: num, dropAmount: int }).strict();
export const zUniqueDropConfig = z.object({ chance: num }).strict();

// progression — hero leveling + ascension economy.
export const zProgressionConfig = z.object({
  heroLevel: z.object({ maxLevel: int, xpBase: num, xpGrowth: num, atkPerLevel: num, hpPerLevel: num }).strict(),
  heroUpgrade: z.object({ ascendLevelCapBonus: int, ascendCrystalCost: int, maxAscensions: int }).strict(),
  abilityMulPerLevel: num.describe('+ability effect strength per ascension level.'),
}).strict();

// orders — the order-board tuning.
export const zOrdersConfig = z.object({
  active: int, arrivalMs: num, itemCount: z.object({ one: num, two: num }).strict(),
  fillerMaxLevel: int, costPerTierBase: num.describe('Tile build-cost base: a tier-t item costs base^t tier-0 drops.'),
  orderChains: z.array(stringConfigRef('chains', 'key')),
  dominantTier: configRecord('gearRarities', 'key', z.tuple([int, int])).describe('Dominant-item tier [min,max] per reward rarity band (keys → gearRarities).'),
  reroll: z.object({ downNear: num, downFar: num, same: num, up: num }).strict(),
}).strict();

// gearTuning — gear generation / leveling / fusion / chest-rarity tuning.
export const zGearTuningConfig = z.object({
  fuse: z.object({ fodder: int, coinBase: num, coinPerTier: num }).strict(),
  gen: z.object({ basePower: num, perTier: num }).strict(),
  level: z.object({ maxLevel: int, xpBase: num, xpGrowth: num, powerPerLevel: num }).strict(),
  chestTiers: z.array(z.object({
    maxDifficulty: num.nullable().describe('Inclusive difficulty ceiling for this chest rarity; null = no upper bound (Infinity).'),
    rarity: stringConfigRef('gearRarities', 'key'),
  }).strict()),
}).strict();

export const zHapticsConfig = z.object({ enabled: z.boolean() }).strict();

// tierPresentation — merge-tier colour ramp (global presentation tuning; not per-entity).
export const zTierPresentationConfig = z.object({ colors: z.array(z.string()) }).strict();

// vfx — weapon trails, impacts, confetti, combat-special colours (global presentation tuning).
export const zVfxConfig = z.object({
  trailByChain: configRecord('chains', 'key', z.object({
    color: z.string(), tail: z.string(), width: num, length: num,
  }).strict()),
  impactColor: configRecord('chains', 'key', z.string()),
  confettiColors: z.array(z.string()),
  combatColors: z.record(z.string(), z.string()).describe('Named combat-special VFX colours (deathDust, waveClear, limitBreak, …).'),
}).strict();
