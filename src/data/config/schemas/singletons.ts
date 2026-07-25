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
// Reusable projectile-trail geometry (width/length/speed/head-radius).
const zTrail = z.object({ width: num, length: num, speed: num, r: num }).strict();

// board — grid dims + squad size + the fresh-account start layout.
export const zBoardConfig = z.object({
  cols: int, rows: int,
  selectedSlots: int.describe('Squad size = first N of the owned order.'),
  drag: z.object({
    liftFactor: num.describe('While dragging, the icon lifts up by this × the tile height so a thumb never covers it.'),
    liftScale: num.describe('A held item scales to this × its resting size (1 = no change).'),
    easeMs: num.describe('Duration (ms) of the lift ease-in on grab / ease-out on release.'),
    easeCurve: z.string().describe('CSS timing-function for the lift ease (natural settle, no bounce).'),
    moveThreshold: num.describe('Pointer travel (px) before a press becomes a drag.'),
    hitTolerance: num.describe('Drop hit-test window as a fraction of cell w/h.'),
    hintDelayMs: num.describe('Hold time (ms) before mergeable tiles are hinted green.'),
    snapBackMs: num, snapBackCurve: z.string(),
    fallbackTile: z.object({ w: num, h: num }).strict().describe('Tile size used before geometry is measured.'),
  }).strict().describe('Held-tile lift + drag/drop interaction tuning.'),
  tiltMaxDeg: num.describe('Max ± lifted-tile tilt (deg); a per-tile hash spreads across [-max,+max].'),
  merge: z.object({
    critTier: int, heavyTier: int,
    burstRadii: z.object({ crit: num, heavy: num, normal: num }).strict().describe('Impact radii by intensity (JUICE pre-baked).'),
    shakeTier: int, shakeAmp: num, shakeBigTier: int, shakeBigAmp: num,
    flashTier: int, flashOpacity: num, flashMs: num,
    confettiTier: int, confettiCount: int, confettiPower: num, confettiColors: z.array(z.string()),
    pushScale: num, squashPeak: z.tuple([num, num]), squashMs: num,
    slamMs: num, slamCurve: z.string(), safetyReleaseMs: num,
  }).strict().describe('Merge burst/shake/flash/confetti + slam-squash tuning.'),
  spawn: z.object({
    popPeak: num, popMs: num, popCurve: z.string(),
    moveMs: num, moveCurve: z.string(),
    birthRevealMs: num, spawnClearMs: num,
    throwApex: num, throwMs: num, throwCurve: z.string(), throwLandScale: z.tuple([num, num]), throwSpin: num,
  }).strict().describe('Tile spawn/move/birth + generator-throw animation.'),
  float: z.object({
    fontBig: num, fontSmall: num, topOffset: num, lifetimeMs: num, fadeMs: num,
    bigTier: int, unlockColor: z.string(),
  }).strict().describe('Float-label size/lifetime + big-tier + cobweb-unlock colour.'),
  idle: z.object({
    bestHintMs: num, waveIdleMs: num, waveGapMs: num, waveGapRandMs: num, pollMs: num, waveColStaggerMs: num,
  }).strict().describe('Idle best-merge hint + ambient wave-bob timing.'),
  startLayout: z.object({
    startingGeneratorKeys: z.array(stringConfigRef('generators', 'key')).default([]).describe('Generators UNLOCKED at boot (→ generators.key). Others in `generators` are placed only once their unlocking area is cleared. Drives board placement + order eligibility.'),
    generators: z.array(z.object({ generator: stringConfigRef('generators', 'key'), cell: int }).strict()).describe('Board cell layout for EVERY generator (→ generators.key); only currently-unlocked ones are placed.'),
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
  defaultAttackMs: num.describe('Fallback basic-attack cadence (ms) when a weapon has no attackMsByWeapon entry.'),
  defaultLimitOrders: int.describe('Fallback orders-to-charge a limit break when a hero omits limit.orders.'),
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
  gearAtkWeight: num, gearHpWeight: num, gearDefWeight: num, powerAtkWeight: num, powerHpDivisor: num,
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
  heroLevel: z.object({ maxLevel: int, xpBase: num, xpGrowth: num, atkPerLevel: num, hpPerLevel: num, defPerLevel: num }).strict(),
  heroUpgrade: z.object({ ascendLevelCapBonus: int, ascendCrystalCost: int, maxAscensions: int }).strict(),
  abilityMulPerLevel: num.describe('+ability effect strength per ascension level.'),
}).strict();

// orders — the order-board tuning.
export const zOrdersConfig = z.object({
  active: int, arrivalMs: num, itemCount: z.object({ one: num, two: num, max: int.describe('Item count above the `two` roll threshold (order size ceiling).') }).strict(),
  fillerMaxLevel: int, costPerTierBase: num.describe('Tile build-cost base: a tier-t item costs base^t tier-0 drops.'),
  orderChains: z.array(stringConfigRef('chains', 'key')),
  dominantTier: configRecord('gearRarities', 'key', z.tuple([int, int])).describe('Dominant-item tier [min,max] per reward rarity band (keys → gearRarities).'),
  reroll: z.object({ downNear: num, downFar: num, same: num, up: num }).strict(),
}).strict();

// gearTuning — gear generation / leveling / fusion / chest-rarity tuning.
export const zGearTuningConfig = z.object({
  fuse: z.object({ fodder: int, coinBase: num, coinPerTier: num }).strict(),
  gen: z.object({ basePower: num, perTier: num, powerSpread: int.describe('Random +[0..powerSpread] variance added to a rolled item base power.') }).strict(),
  level: z.object({ maxLevel: int, xpBase: num, xpGrowth: num, powerPerLevel: num }).strict(),
  chestTiers: z.array(z.object({
    maxDifficulty: num.nullable().describe('Inclusive difficulty ceiling for this chest rarity; null = no upper bound (Infinity).'),
    rarity: stringConfigRef('gearRarities', 'key'),
  }).strict()),
}).strict();

export const zHapticsConfig = z.object({
  enabled: z.boolean(),
  throttleMs: z.object({ generatorDrop: num, bossSlam: num, crit: num }).strict().describe('Per-source haptic rate gates (ms).'),
  mergeTier: z.object({ heavy: int, medium: int }).strict().describe('Merge tier thresholds for heavy/medium haptic.'),
  gachaTier: z.object({ jackpot: int, success: int }).strict().describe('Best-pull rarity-tier thresholds for jackpot/success haptic.'),
}).strict();

// runtime — controller/loop timers + gacha knobs (not part of the combat sim step).
export const zRuntimeConfig = z.object({
  regenTickMs: num.describe('Energy-regen recompute interval (ms) owned by the controller.'),
  persistThrottleMs: num.describe('Minimum interval (ms) between throttled saves.'),
  tenPullCount: int.describe('Pulls in a multi-pull ("ten-pull"); selects banner.ten pricing.'),
}).strict();

// reveal — reward/reveal-sequence tuning (gacha pull, chest smash, hero level-up FX, currency pickup).
// Presentational timings/sizes/counts for the reward cinematics; pure keyframe SHAPES stay inline.
export const zRevealConfig = z.object({
  currency: z.object({
    staggerMs: num, itemStaggerMs: num, pulseScale: num, pulseMs: num,
    iconsPerAmount: num, iconsMin: num, iconsMax: num, iconSize: num, iconFont: num, glowColor: z.string(),
    burstSpeed: z.tuple([num, num]), burstUp: num, ctrlJitter: num, arcApex: z.tuple([num, num]),
    burstMs: num, hangMs: num, arcMs: num, iconDelayMs: num, removeMs: num, reaperMs: num, counterFallbackMs: num,
    throwSize: num, throwFont: num, throwApex: num, throwMs: num,
    spend: z.object({ count: int, color: z.string(), font: num, fan: z.tuple([num, num]), speed: z.tuple([num, num]), grav: num, durMs: z.tuple([num, num]), rot: num, reaperMs: num }).strict(),
  }).strict().describe('Currency burst→arc→HUD-tally pickup + generator throw + spend-burst tuning.'),
  chest: z.object({
    popOvershoot: num.describe('easeOutBack overshoot for the chest pop-in.'), rattleMs: num,
    fanOffsets: z.array(num).describe('Per-reward horizontal fan offsets (px) around the chest.'),
    fallbackY: num, clampInset: num, viewInset: z.tuple([num, num]), iconSize: num, iconEmojiRatio: num,
    popMs: num, offscreenY: num, upMs: num, descendMs: num,
    hitWindowBaseMs: num, hitWindowPerTierMs: num, shotMs: num,
    peltTrail: z.object({ color: z.string(), tail: z.string(), width: num, length: num, speed: num, r: num }).strict(),
    peltImpactColor: z.string(), peltImpactR: num,
    smashFlash: z.object({ opacity: num, ms: num, color: z.string() }).strict(), smashImpactR: num, slotSafetyMs: num,
  }).strict().describe('Chest smash-to-open sequence: pop, fan, pelt-shot trail/impact, smash flash.'),
  heroFx: z.object({
    flashMs: num, raysMs: num, ringCount: int, ringBaseMs: num, ringStepMs: num, ringDelayMs: num,
    sparkCount: int, sparkDistBase: num, sparkDistSpread: num, sparkBaseMs: num, sparkSpreadMs: num,
    burstCount: z.tuple([num, num]), burstBase: z.tuple([num, num]), burstSpread: z.tuple([num, num]), burstSize: z.tuple([num, num]), burstMs: z.tuple([num, num]), burstSpreadMs: num,
    bigRingMs: num, floatMs: num, tweenScale: num,
    maxedTyperMs: num, maxedWobbleMs: num, maxedHoldMs: num, maxedExitMs: num,
    levelUpStatAtkFrac: num.describe('Fraction of a level-up gain shown as the ATK float split.'),
    levelUpStatHpFrac: num.describe('Fraction of a level-up gain shown as the HP float split.'),
    levelUpStaggerMax: num, levelUpStaggerMin: num, levelUpStaggerCap: num, levelUpStatDelayMs: num, levelUpStatBaseMs: num,
    tileScale: z.tuple([num, num]), tileMs: z.tuple([num, num]), tileGlowBlur: z.tuple([num, num]), tileGlowSpread: z.tuple([num, num]), tileGlowMs: z.tuple([num, num]),
    powTweenMs: z.tuple([num, num]), lvTweenMs: z.tuple([num, num]), maxedDelayMs: num,
    slotScale: num, slotMs: num, slotStaggerMax: num, slotStaggerMin: num, slotStaggerCap: num,
    levelAllStaggerMs: num, multiFloatDurMs: num,
    equipMs: num, equipStaggerMs: num, equipPowMs: num, equipTailMs: num,
    fuseCloneSize: num, fuseCloneFont: num, fuseFlyMs: num, fuseFlyStaggerMs: num, fuseReaperMs: num, fuseLandTailMs: num,
    fuseFlash: z.object({ opacity: num, ms: num }).strict(), fuseShake: num, fuseImpactR: num,
  }).strict().describe('Hero level-up / equip / fuse burst, ray, float, and tile-pulse FX.'),
  gacha: z.object({
    tenDwell: z.tuple([num, num, num, num, num, num]).describe('Per-tier dwell (ms) between ×10 reveals, common→PRIMAL.'),
    tenDwellFallbackMs: num, msFallbackMs: num, veilMs: num, veilReducedMs: num,
    heroGlowBase: num, heroGlowPerTier: num, heroDurTierMs: z.tuple([num, num, num]), heroDurReducedMs: num,
    auraOpacity: z.tuple([num, num]), auraMs: num, ringOpacity: num, ringMs: num,
    plateMs: z.tuple([num, num]), plateReducedMs: num, pipMs: num, pipReducedMs: num, hintOpacity: num, hintMs: num,
    summaryTileMs: num, summaryTileReducedMs: num, summaryTileStaggerMs: num, summaryTileBaseMs: num,
    engineFadeMs: num, engineFadeReducedMs: num, dismissMs: num, dismissReducedMs: num,
  }).strict().describe('Gacha single/×10 reveal: hero pop, aura, plate, pip, summary-grid stagger.'),
  reveal: z.object({
    maxParticles: int.describe('Reveal-engine particle-pool cap (MAX_P).'),
    rarity: z.record(z.string(), z.object({
      id: z.string(), col: z.string(), glowR: num, ms: num, tier: int, pips: int, disp: z.string(), prismatic: z.boolean().optional(),
    }).strict()).describe('Reveal-engine per-tier theme (VFX colour + glow + duration + tier/pips), keyed common→primal.'),
    ladder: z.object({
      flash: z.array(num), rings: z.array(num), burst: z.array(num), shake: z.array(num), shakeRot: z.array(num),
      chroma: z.array(num), confetti: z.array(num), rays: z.array(num), slowmo: z.array(num), stars: z.array(num),
    }).strict().describe('Per-tier climax/build escalation ladders (indexed by tier 0-5).'),
    timeline: z.object({ anticMs: num, buildFrac: num, buildMin: num, buildMax: num, climaxFrac: num, climaxMin: num, climaxMax: num }).strict().describe('6-beat pacing: anticipation + build/climax fraction-of-duration clamps.'),
    afterglow: z.object({ rateByTier: z.array(num), intervalMs: num }).strict(),
    reduced: z.object({ particleScale: num, chromaMax: num, flashScale: num }).strict().describe('prefers-reduced-motion scalers (particle count, chroma cap, flash peak).'),
  }).strict().describe('Reveal-engine cinematic tuning surface (tables + pacing); per-particle SHAPE stays inline.'),
}).strict();

// anim — UI + intro interaction/animation tuning (drag gestures, FLIP timings, screen
// interaction knobs). Verbatim-ported cinematics (intro-director) keep per-keyframe SHAPE
// inline; this holds the genuinely-tunable knobs + shared easing curves.
export const zAnimConfig = z.object({
  curves: z.object({ easeOut: z.string(), easeOutQuad: z.string() }).strict().describe('Shared CSS timing-functions for FLIP / glide transitions.'),
  scrollDragThreshold: num.describe('Pointer travel (px) before a rail/list press becomes a scroll-drag (Orders, Map).'),
  fuseRevealMs: num.describe('Hold (ms) of the just-fused rarity-up reveal class (Heroes + Gear screens).'),
  intro: z.object({
    exitDriftPx: num.describe('Level-intro stack exit drift below its -50% centre anchor.'),
    threatCap: int, threatBase: int.describe('Boss threat = min(threatCap, zoneIndex + threatBase).'),
    moteCount: int.describe('Ambient area-intro mote count.'),
  }).strict(),
  autobattler: z.object({
    realignMs: num.describe('Enemy-row FLIP realign duration (ms) when a slain enemy leaves the flow.'),
    trackWindow: int.describe('Level-track dot count.'), trackPast: int.describe('Levels shown behind the current one.'),
    chargePips: int.describe('Hero limit-charge pip segments.'),
    embers: z.array(z.object({ l: num, d: num, dur: num, s: num }).strict()).describe('Ambient ember decoration: left%, delay s, duration s, size px.'),
  }).strict(),
  orders: z.object({ flipMs: num, wipeInMs: num, wipeOutMs: num, wipeSwapMs: num }).strict().describe('Order-rail FLIP + reroll white-wipe timings.'),
  heroes: z.object({
    dragHoldMs: num, dragScrollTol: num, dragMoveTol: num, dragLiftFrac: num, dragAvatarScale: num,
    dragGlideMs: num, dragSwapMs: num, dragClickSuppressMs: num, popGap: num, popMargin: num,
  }).strict().describe('Roster drag-swap gesture + popup placement tuning.'),
  gear: z.object({ powFlashMs: num.describe('Gear-sheet power-number flash duration (ms).') }).strict(),
  gacha: z.object({ pityNearFrac: num.describe('Pity progress fraction at which a pity pill highlights as "near".') }).strict(),
  areaComplete: z.object({
    countUpMs: num.describe('AREA CLEARED synopsis reward count-up duration (ms).'),
    appearMs: num.describe('Generator burst-in (materialize) duration (ms).'),
    holdMs: num.describe('Generator centre-stage hold before it flies to the board (ms).'),
    flyMs: num.describe('Generator arc-to-board-cell flight duration (ms).'),
    landMs: num.describe('Generator landing slam/pop duration (ms).'),
  }).strict().describe('AREA COMPLETE board-award cinematic feel timings.'),
}).strict();

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
  hpbar: z.object({
    ghostLerpSec: num, wholeFlashSec: num, pinkFlashSec: num, whiteBlipSec: num,
    wholeFlash: z.object({ brightness: num, saturate: num, dropShadowPx: num, shadowColor: z.string() }).strict(),
    pinkFlash: z.object({ brightness: num, saturate: num }).strict(),
    ghostColor: z.object({ enemy: z.string(), hero: z.string() }).strict(),
  }).strict().describe('Damage-feedback HP-bar layers: ghost catch-up + flash timings/magnitudes + lost-HP colours.'),
  engine: z.object({
    trail: z.object({ spineN: int, minSpacingPx: num, maxAgeBase: num, lengthRef: num, lutN: int, maxParticles: int }).strict(),
    spawnTrail: z.object({ speed: num, head: z.string(), tail: z.string(), r: num, width: num, length: num, alpha: num, glowRMul: num, glowAlpha: num }).strict(),
    flash: z.object({ peak: num, ms: num, color: z.string() }).strict(),
    shake: z.object({ decayBase: num, restThreshold: num }).strict(),
    dprMax: num,
    glow: z.object({ peak: num, stops: z.tuple([num, num]), alphas: z.tuple([num, num]) }).strict(),
    impact: z.object({
      count: int, sizeMin: num, sizeMax: num, speed: num, speedMul: num, life: num, spread: num,
      tier: z.record(z.string(), z.object({ count: num, size: num, speed: num, life: num }).strict()),
      color: z.string(), r: num,
      disc: z.object({ dur: num, r0Mul: num, r1Mul: num }).strict(),
      ring: z.object({ dur: num, r1MulCrit: num, r1Mul: num, w0: num }).strict(),
      ring2: z.object({ delay: num, dur: num, r1Mul: num, w0: num, color: z.string() }).strict(),
      debrisSpeedMul: num, speedJitter: z.tuple([num, num]), ringAlpha: num, ringTaper: num, shakeCrit: num, shakeHeavy: num,
    }).strict(),
    confetti: z.object({
      count: int, speed: z.tuple([num, num]), up: z.tuple([num, num]), life: z.tuple([num, num]), size: z.tuple([num, num]), aspect: z.tuple([num, num]),
      vrot: num, grav: z.tuple([num, num]), swayFreq: z.tuple([num, num]), swayAmp: z.tuple([num, num]), termVel: num, fadeFrom: num, dragBase: num,
    }).strict(),
    debris: z.object({ stroke: z.string(), sizeBase: num, sizeAlpha: num }).strict(),
  }).strict().describe('Canvas fx-engine primitives: trail/impact/confetti/flash/shake/glow tuning.'),
  combat: z.object({
    fallbackCanvas: z.object({ w: num, h: num }).strict().describe('App-frame size used when the fx canvas is not yet measured.'),
    hitFlash: z.object({ brightness: num, peakOffset: num, ms: num }).strict(),
    chipShake: z.object({ ms: num }).strict(),
    arenaShake: z.object({ amp: num, ms: num }).strict(),
    cardFlash: z.object({ brightness: num, ms: num }).strict(),
    telegraph: z.object({ scale: num, brightness: num, hostileBrightness: num, hostileSaturate: num, offset: num, ms: num }).strict(),
    heroAttack: z.object({ stagger: num, trailDelay: num, trailSpeed: num, trailR: num, impactCrit: num, impactNormal: num, splashDelay: num, deathDustDelay: num, critShake: num }).strict(),
    deathDust: z.object({ r: num }).strict(),
    limitPulse: z.object({ brightness: num, scale: num, offset: num, ms: num }).strict(),
    limitCharge: z.object({ stagger: num, trail: zTrail, impactR: num }).strict(),
    orderChest: z.object({ fallbackY: num, trailSpeed: num, impactR: num, tileStagger: num, baseDelay: num }).strict(),
    waveClear: z.object({ impactR: num, shake: num }).strict(),
    levelComplete: z.object({ originY: num, confettiX: num, confettiY: num, confettiCount: int, flashOpacity: num, flashMs: num }).strict(),
    limitBreak: z.object({ impactR: num, arenaShake: num, deathDustDelay: num, cineMs: num, cineOffset: num, beamSkew: num, beamMs: num, flashOpacity: num, flashMs: num, screenShake: num }).strict(),
    enemyAttack: z.object({ stagger: num, trailDelay: num, trail: zTrail, impactR: num, hurtDelay: num }).strict(),
    damageNumberMs: num, comboMs: num,
    comboTag: z.object({ yOffset: num, fontBase: num, fontPerN: num, fontMax: num, ms: num, hotColor: z.string(), warmColor: z.string(), baseColor: z.string(), hotN: int, warmN: int }).strict(),
    bossTelegraph: z.object({ ringSize: num, fromScale: num, fromOpacity: num, toScale: num, toOpacity: num }).strict(),
    bossSpecial: z.object({ impactR: num, trail: zTrail, hitR: num, stagger: num, numberDelay: num, flashOpacity: num, flashMs: num, screenShake: num, shockSize: num, shockFromScale: num, shockToScale: num, shockMs: num, shockCurve: z.string() }).strict(),
    bossHeal: z.object({ pulseBrightness: num, pulseOffset: num, pulseMs: num, wisp: zTrail }).strict(),
    bossRaise: z.object({ arenaShake: num, castBrightness: num, castOffset: num, castMs: num, ringSize: num, ringFromScale: num, ringFromOpacity: num, ringToScale: num, ringMs: num, minionR: num, riseBrightness: num, riseFromScale: num, riseMs: num, riseBaseDelay: num, riseStagger: num }).strict(),
  }).strict().describe('Per-effect combat VFX: hit/flash/shake/telegraph, trails, boss beats.'),
}).strict();
