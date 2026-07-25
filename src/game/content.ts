// === content — the sim's read-model over the baked config bundle ===
//
// Reconstructs MergeCombat's exact data shape (slug-keyed maps + tuning singletons) from the
// validated `virtual:game-config` bundle, so the ported pure model reads it near-verbatim AND the sim
// stays headless-testable (the bundle is INJECTED — `createContent(bundle)` — not a hardcoded import,
// so a node harness can build a bundle and drive the sim with zero DOM/vite). zod never enters here
// (plain bundle reads). Also exposes slug↔numeric-id maps for the account boundary (items.configId).
import type { GameConfigBundle } from 'virtual:game-config';

type Row = Record<string, any>;
const idToSlug = (arr: Row[] | undefined) => Object.fromEntries((arr ?? []).map((e) => [e.id, e.displayName]));
const slugToId = (arr: Row[] | undefined) => Object.fromEntries((arr ?? []).map((e) => [e.displayName, e.id]));

export type Content = ReturnType<typeof createContent>;

// The content SINGLETON (a live binding), set once at boot from the baked bundle — the sim's data
// layer, like the framework's store.ts. `initContent` runs before any sim call (app boot passes
// virtual:game-config; a headless harness passes a scanned bundle). Model modules read `C` directly,
// so the ported model + reducer stay near-verbatim (no threading C through every call).
export let C: Content = undefined as unknown as Content;
export function initContent(bundle: GameConfigBundle): Content {
  C = createContent(bundle);
  return C;
}

// C is initialised once at boot BEFORE any view/config reader evaluates:
//  • App: src/game/boot-content.ts (imported first in main.tsx) statically imports the baked
//    virtual:game-config and calls initContent synchronously.
//  • Headless: the node harness calls initContent(scannedBundle) explicitly.
// (No top-level await here — it isn't available at the production build target.)

export function createContent(bundle: GameConfigBundle) {
  const b = bundle as unknown as Record<string, any>;
  const enemyIdToSlug = idToSlug(b.enemies);
  const heroIdToSlug = idToSlug(b.heroes);
  const pieceIdToSlug = idToSlug(b.gearPieces);
  const sid = (map: Record<number, string>, id: number) => map[id];

  // ── chains / generators ──
  const CHAINS = Object.fromEntries((b.chains ?? []).map((c: Row) => [c.key, { id: c.key, tiers: c.tiers }]));
  const GENERATORS = Object.fromEntries((b.generators ?? []).map((g: Row) => [g.key, { id: g.key, chain: g.chainKey, weapon: g.weapon, energyCost: g.energyCost, drops: g.drops }]));

  // ── rarities (hero) ──
  const rar: Row[] = (b.rarities ?? []).slice().sort((a: Row, z: Row) => a.order - z.order);
  const HERO_RARITIES: Record<string, any> = Object.fromEntries(rar.map((r: Row) => [r.key, { id: r.key, tier: r.tier, pips: r.pips, prismatic: !!r.prismatic }]));
  const HERO_RARITY_ORDER: string[] = rar.map((r: Row) => r.key);
  const RARITY_STAT_MUL = Object.fromEntries(rar.map((r: Row) => [r.key, r.statMul]));
  const LEVEL_CAP = Object.fromEntries(rar.map((r: Row) => [r.key, r.levelCap]));

  // ── gear rarities + pieces + tuning ──
  const grar: Row[] = (b.gearRarities ?? []).slice().sort((a: Row, z: Row) => a.order - z.order);
  const GEAR_RARITY: Record<string, any> = Object.fromEntries(grar.map((r: Row) => [r.key, { mul: r.mul }]));
  const GEAR_RARITY_ORDER: string[] = grar.map((r: Row) => r.key);
  const GEAR_SLOTS: string[] = (b.gearSlots ?? []).map((s: Row) => s.key);
  const GEAR_PIECES = Object.fromEntries((b.gearPieces ?? []).map((p: Row) => [p.displayName, { slot: p.slot, name: p.displayName, maxRarity: p.maxRarityKey, unique: !!p.unique, asset: p.displayName }]));
  const gt = b.gearTuning ?? {};
  const GEAR_FUSE = gt.fuse; const GEAR_GEN = gt.gen; const GEAR_LEVEL = gt.level;
  // chest tiers: null maxDifficulty (JSON) → Infinity (the model uses <= comparisons).
  const GEAR_CHEST_TIERS = (gt.chestTiers ?? []).map((t: Row) => ({ maxDifficulty: t.maxDifficulty == null ? Infinity : t.maxDifficulty, rarity: t.rarity }));

  // ── heroes ──
  const HEROES = Object.fromEntries((b.heroes ?? []).map((h: Row) => [h.displayName, {
    id: h.displayName, rarity: h.rarityKey, weapon: h.weaponChainKey, baseAtk: h.baseAtk, baseHp: h.baseHp, baseDef: h.baseDef,
    normal: h.normal, limit: h.limit,
  }]));

  // ── enemies (slug-keyed, incl. bosses) ──
  const ENEMY_BY_ID = Object.fromEntries((b.enemies ?? []).map((e: Row) => [e.displayName, { id: e.displayName, hpMul: e.hpMul, atkMul: e.atkMul, boss: !!e.boss }]));
  const ENEMY_ARCHETYPES = (b.enemies ?? []).filter((e: Row) => !e.boss).map((e: Row) => ENEMY_BY_ID[e.displayName]);

  // ── zones (ordered; refs mapped id→slug) ──
  const ZONES = (b.zones ?? []).slice().sort((a: Row, z: Row) => a.order - z.order).map((z: Row) => ({
    id: z.displayName,
    enemyPool: (z.enemyPoolConfigIds ?? []).map((id: number) => sid(enemyIdToSlug, id)),
    bossId: sid(enemyIdToSlug, z.bossConfigId), accompliceId: sid(enemyIdToSlug, z.accompliceConfigId),
    crystal: z.crystalRarityKey, orderRarity: z.orderRarity,
    items: (z.itemConfigIds ?? []).map((id: number) => sid(pieceIdToSlug, id)),
    unlocksGenerators: (z.unlocksGeneratorKeys ?? []) as string[], // generator keys unlocked on first clearing this area
  }));

  // ── banners (ordered by id; pools mapped id→slug) ──
  const bannersArr = (b.banners ?? []).slice().sort((a: Row, z: Row) => a.id - z.id);
  const BANNERS = Object.fromEntries(bannersArr.map((bn: Row) => [bn.displayName, {
    id: bn.displayName, cost: bn.cost, ten: bn.ten, limited: !!bn.limited, weights: bn.weights,
    pity: (bn.pity ?? []).map((p: Row) => ({ rarity: p.rarityKey, max: p.max })),
    pool: (bn.heroPoolConfigIds ?? []).map((id: number) => sid(heroIdToSlug, id)),
  }]));
  const BANNER_ORDER = bannersArr.map((bn: Row) => bn.displayName);
  const EXCLUSIVE_POOL = (BANNERS.exclusive && BANNERS.exclusive.pool) || [];

  // ── singletons (tuning; LEVEL_SCALING boss accomplice mapped id→slug) ──
  const LEVEL_SCALING = { ...b.levelScaling, bossAccompliceId: sid(enemyIdToSlug, b.levelScaling.bossAccompliceConfigId) };

  return {
    CHAINS, GENERATORS, HERO_RARITIES, HERO_RARITY_ORDER, RARITY_STAT_MUL, LEVEL_CAP,
    GEAR_RARITY, GEAR_RARITY_ORDER, GEAR_SLOTS, GEAR_PIECES, GEAR_FUSE, GEAR_GEN, GEAR_LEVEL, GEAR_CHEST_TIERS,
    HEROES, ENEMY_BY_ID, ENEMY_ARCHETYPES, ZONES, ZONE_LEN: b.levelScaling.bossEvery, BANNERS, BANNER_ORDER, EXCLUSIVE_POOL,
    LEVEL_SCALING,
    BATTLE: b.battle, NODE: b.node, AFK: b.afk, ENERGY: b.energy, BOARD: b.board, HERO_COMBAT: b.heroCombat,
    HERO_LEVEL: b.progression.heroLevel, HERO_UPGRADE: b.progression.heroUpgrade, ABILITY_MUL_PER_LEVEL: b.progression.abilityMulPerLevel,
    ORDER_CONFIG: { active: b.orders.active, arrivalMs: b.orders.arrivalMs, itemCount: b.orders.itemCount, fillerMaxLevel: b.orders.fillerMaxLevel, costPerTierBase: b.orders.costPerTierBase },
    ORDER_CHAINS: b.orders.orderChains as string[], ORDER_DOMINANT_TIER: b.orders.dominantTier as Record<string, [number, number]>, ORDER_REROLL: b.orders.reroll,
    CRYSTAL: b.crystalDrop, UNIQUE_DROP: b.uniqueDrop, TIER_PRESENTATION: b.tierPresentation, VFX: b.vfx, HAPTICS: b.haptics, RUNTIME: b.runtime, REVEAL: b.reveal, ANIM: b.anim,
    // derived: fresh-crystal wallet (all rarities zero) + the starter hero roster + well-known refs
    EMPTY_CRYSTALS: Object.fromEntries(HERO_RARITY_ORDER.map((k: string) => [k, 0])) as Record<string, number>,
    STARTER_HEROES: [heroIdToSlug[(b.refs || {}).starterHeroConfigId]].filter(Boolean) as string[],
    STARTING_GENERATORS: ((b.board?.startLayout?.startingGeneratorKeys ?? []) as string[]), // generators unlocked at boot; grows as areas are cleared

    REFS: (b.refs || {}) as Record<string, number>,
    // UI registry (presentation) — so view-side barrels can re-combine logical + name/colour into the
    // shape the view reads (single source: the registries; NOT a parallel data copy).
    ui: (b.ui || {}) as Record<string, Record<string, any>>,
    // id↔slug maps for the account boundary + presentation lookup by slug (every id-kind category)
    heroIdToSlug, heroSlugToId: slugToId(b.heroes), enemyIdToSlug, enemySlugToId: slugToId(b.enemies),
    pieceIdToSlug, pieceSlugToId: slugToId(b.gearPieces),
    zoneSlugToId: slugToId(b.zones), bannerSlugToId: slugToId(b.banners),
  };
}
