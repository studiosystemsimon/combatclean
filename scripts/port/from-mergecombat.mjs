#!/usr/bin/env node
/**
 * from-mergecombat.mjs — FAITHFUL one-way port of MergeCombat's static `data/*` modules into
 * combatclean's three registries (logical config-registry JSON + UI config). READ-ONLY on
 * ~/mergecombat (imports its data modules for their exact values — zero transcription error, and
 * re-runnable while mergecombat stays the reference). Writes ONLY under combatclean.
 *
 * Output is governed by the SAME gates as hand-authored content (schemas + `config/visual/assets
 * validate` + the build compose) — this is a bulk writer, not a parallel governance path.
 *
 * Mapping: id-kind (numeric) = resources/heroes/enemies/gearPieces/zones/banners (account-referenceable);
 * key-kind (slug) = chains/generators/rarities/gearRarities/gearSlots; the rest → singletons. Slugs are
 * mapped to allocated numeric ids for every cross-ref. Presentation (names/colours/ability names/biome/
 * theme/power text/emoji) → UI config; every multiplier is an exposed named field (no hidden mutators).
 */
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MC = '/Users/simonhill/mergecombat/src/data';
const imp = async (m) => import(`${MC}/${m}`);
const { CHAINS } = await imp('chains.js');
const { GENERATORS } = await imp('generators.js');
const { HERO_RARITIES, HERO_RARITY_ORDER, RARITY_STAT_MUL, LEVEL_CAP, ABILITY_MUL_PER_LEVEL } = await imp('rarities.js');
const { HEROES } = await imp('heroes.js');
const { ENEMY_ARCHETYPES, BOSS_ARCHETYPES, LEVEL_SCALING } = await imp('enemies.js');
const gear = await imp('gear.js');
const { ZONES } = await imp('zones.js');
const { BANNERS, BANNER_ORDER, EXCLUSIVE_POOL } = await imp('banners.js');
const { ORDER_CHAINS, ORDER_CONFIG, ORDER_DOMINANT_TIER, ORDER_REROLL } = await imp('orders.js');
const { HERO_LEVEL, HERO_UPGRADE } = await imp('progression.js');
const cfg = await imp('config.js');
const { STRINGS } = await imp('strings.js');
const { ASSETS } = await imp('assets.js');

const ROOT = '/Users/simonhill/combatclean/src/data/config';
const GAME = join(ROOT, 'game');
const UI = join(ROOT, 'ui');

// ── clean the per-entity content (keep schemas + ui-schema.ts) ──
rmSync(GAME, { recursive: true, force: true });
for (const d of readdirSync(UI, { withFileTypes: true })) if (d.isDirectory()) rmSync(join(UI, d.name), { recursive: true, force: true });
rmSync('/Users/simonhill/combatclean/src/data/visual-config', { recursive: true, force: true }); // MergeCombat has no per-entity VSM

const slug = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const wr = (dir, file, obj) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${file}.json`), `${JSON.stringify(obj, null, '\t')}\n`); };
const wrId = (cat, id, dn, obj) => wr(join(GAME, cat), `${id}-${slug(dn)}`, { id, displayName: dn, ...obj });
const wrKey = (cat, key, obj) => wr(join(GAME, cat), slug(key), { key, ...obj });
const wrUI = (cat, file, obj) => wr(join(UI, cat), file, obj);
const emojiOf = (assetKey) => (ASSETS[assetKey] && ASSETS[assetKey].emoji) || undefined;
// iconAssetId is set ONLY when the key has real PNG art (MergeCombat is emoji-fallback: banners +
// some ui.* have no art). Art-less keys carry just the emoji, so the build asset-ref gate stays clean.
const icon = (assetKey) => (ASSETS[assetKey] && ASSETS[assetKey].art) ? assetKey : undefined;
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

const ledger = {};

// ── key-kind: chains / generators / rarities / gearRarities / gearSlots ──
for (const [k, c] of Object.entries(CHAINS)) { wrKey('chains', k, { tiers: c.tiers }); wrUI('chains', k, { key: k, name: c.name }); }

for (const [k, g] of Object.entries(GENERATORS)) {
  wrKey('generators', k, { chainKey: g.chain, weapon: g.weapon, energyCost: g.energyCost, drops: g.drops });
  wrUI('generators', k, clean({ key: k, name: (ASSETS[g.asset] && ASSETS[g.asset].label) || k, iconAssetId: icon(g.asset), emoji: emojiOf(g.asset) }));
}

HERO_RARITY_ORDER.forEach((k, i) => {
  const r = HERO_RARITIES[k];
  wrKey('rarities', k, clean({ order: i, tier: r.tier, pips: r.pips, statMul: RARITY_STAT_MUL[k], levelCap: LEVEL_CAP[k], prismatic: r.prismatic }));
  wrUI('rarities', k, { key: k, name: r.name, color: r.color });
});

gear.GEAR_RARITY_ORDER.forEach((k, i) => {
  const r = gear.GEAR_RARITY[k];
  wrKey('gearRarities', k, { order: i, mul: r.mul });
  wrUI('gearRarities', k, { key: k, name: r.name, color: r.color });
});

for (const k of gear.GEAR_SLOTS) {
  const m = gear.GEAR_SLOT_META[k];
  wrKey('gearSlots', k, {});
  wrUI('gearSlots', k, clean({ key: k, name: m.name, iconAssetId: icon(m.asset) }));
}

// ── id-kind: resources (hand-defined wallet: coins/heroXp/gearXp/energy + 6 crystals) ──
const resId = {}; let rid = 1000;
const addRes = (slugName, dn, logical, ui) => { const id = rid++; resId[slugName] = id; wrId('resources', id, dn, logical); wrUI('resources', id, clean({ id, ...ui })); };
addRes('coins', 'coins', { wallet: true }, { name: 'Coins', iconAssetId: icon('ui.coin'), emoji: emojiOf('ui.coin'), color: cfg.VFX_CONFIG.combatColors.currencyCoin });
addRes('heroXp', 'heroXp', { wallet: true }, { name: 'Hero XP', iconAssetId: icon('ui.heroXp'), emoji: emojiOf('ui.heroXp'), color: cfg.VFX_CONFIG.combatColors.currencyHeroXp });
addRes('gearXp', 'gearXp', { wallet: true }, { name: 'Gear XP', iconAssetId: icon('ui.gearXp'), emoji: emojiOf('ui.gearXp'), color: cfg.VFX_CONFIG.combatColors.currencyGearXp });
addRes('energy', 'energy', { wallet: true }, { name: 'Energy', iconAssetId: icon('ui.energy'), emoji: emojiOf('ui.energy') });
const crystalResId = {};
for (const k of HERO_RARITY_ORDER) {
  const id = rid++; const slugName = `crystal_${k}`; resId[slugName] = id; crystalResId[k] = id;
  wrId('resources', id, slugName, { wallet: true, crystalRarityKey: k });
  wrUI('resources', id, clean({ id, name: `${HERO_RARITIES[k].name.replace(/^./, (c) => c.toUpperCase())} Crystal`, iconAssetId: icon('ui.crystal'), emoji: emojiOf('ui.crystal'), color: HERO_RARITIES[k].color }));
}
ledger.resources = rid - 1;

// ── id-kind: heroes ──
const heroId = {}; let hid = 2000;
for (const [k, h] of Object.entries(HEROES)) {
  const id = hid++; heroId[k] = id;
  wrId('heroes', id, k, {
    rarityKey: h.rarity, weaponChainKey: h.weapon, baseAtk: h.baseAtk, baseHp: h.baseHp,
    normal: { chargeMs: h.normal.chargeMs, effect: h.normal.effect },
    limit: { orders: h.limit.orders, effect: h.limit.effect },
  });
  wrUI('heroes', id, clean({ id, name: h.name, iconAssetId: icon(`hero.${k}`), emoji: emojiOf(`hero.${k}`), abilityNames: { basic: h.basic.name, normal: h.normal.name, limit: h.limit.name } }));
}
ledger.heroes = hid - 1;

// ── id-kind: enemies (regular + bosses) ──
const enemyId = {}; let eid = 3000;
const addEnemy = (a, boss) => {
  const id = eid++; enemyId[a.id] = id;
  wrId('enemies', id, a.id, clean({ hpMul: a.hpMul, atkMul: a.atkMul, boss: boss || undefined }));
  wrUI('enemies', id, clean({ id, name: a.name, iconAssetId: icon(`enemy.${a.id}`), emoji: emojiOf(`enemy.${a.id}`) }));
};
for (const a of ENEMY_ARCHETYPES) addEnemy(a, false);
for (const a of BOSS_ARCHETYPES) addEnemy(a, true);
ledger.enemies = eid - 1;

// ── id-kind: gearPieces ──
const pieceId = {}; let gid = 4000;
for (const [k, p] of Object.entries(gear.GEAR_PIECES)) {
  const id = gid++; pieceId[k] = id;
  wrId('gearPieces', id, k, clean({ slot: p.slot, maxRarityKey: p.maxRarity, unique: p.unique || undefined }));
  const iconKey = p.unique ? p.asset : gear.GEAR_SLOT_META[p.slot].asset;
  wrUI('gearPieces', id, clean({ id, name: p.name, iconAssetId: icon(iconKey), emoji: emojiOf(iconKey), power: p.power }));
}
ledger.gearPieces = gid - 1;

// ── id-kind: zones ──
const zoneId = {}; let zid = 5000;
ZONES.forEach((z, i) => {
  const id = zid++; zoneId[z.id] = id;
  wrId('zones', id, z.id, {
    order: i,
    enemyPoolConfigIds: z.enemyPool.map((s) => enemyId[s]),
    bossConfigId: enemyId[z.bossId], accompliceConfigId: enemyId[z.accompliceId],
    crystalRarityKey: z.crystal, orderRarity: z.orderRarity,
    itemConfigIds: z.items.map((s) => pieceId[s]),
  });
  wrUI('zones', id, clean({ id, name: (STRINGS.zones && STRINGS.zones[z.nameKey]) || z.nameKey, iconAssetId: icon(z.keyArt), biome: z.biome }));
});
ledger.zones = zid - 1;

// ── id-kind: banners ──
const bannerId = {}; let bid = 6000;
for (const k of BANNER_ORDER) {
  const b = BANNERS[k]; const id = bid++; bannerId[k] = id;
  wrId('banners', id, k, clean({
    currencyConfigId: resId.coins, cost: b.cost, ten: b.ten, limited: b.limited || undefined,
    weights: b.weights, pity: b.pity.map((p) => ({ rarityKey: p.rarity, max: p.max })),
    heroPoolConfigIds: k === 'exclusive' ? EXCLUSIVE_POOL.map((s) => heroId[s]) : undefined,
  }));
  wrUI('banners', id, clean({ id, name: b.name, description: b.sub, iconAssetId: icon(b.faceAsset), theme: b.theme, theme2: b.theme2 }));
}
ledger.banners = bid - 1;

// ── singletons (config.js grab-bag + tuning modules) ──
const S = (name, obj) => wr(GAME, `_${name}`, obj);
S('board', { cols: cfg.BOARD.cols, rows: cfg.BOARD.rows, selectedSlots: cfg.SELECTED_SLOTS, startLayout: { generators: cfg.START_LAYOUT.generators, seedItems: cfg.START_LAYOUT.seedItems } });
S('energy', cfg.ENERGY);
S('battle', cfg.BATTLE);
S('heroCombat', cfg.HERO_COMBAT);
S('levelScaling', clean({ ...LEVEL_SCALING, bossAccompliceConfigId: enemyId[LEVEL_SCALING.bossAccompliceId], bossAccompliceId: undefined }));
S('node', cfg.NODE);
S('afk', cfg.AFK);
S('crystalDrop', cfg.CRYSTAL);
S('uniqueDrop', cfg.UNIQUE_DROP);
S('progression', { heroLevel: HERO_LEVEL, heroUpgrade: HERO_UPGRADE, abilityMulPerLevel: ABILITY_MUL_PER_LEVEL });
S('orders', { active: ORDER_CONFIG.active, arrivalMs: ORDER_CONFIG.arrivalMs, itemCount: ORDER_CONFIG.itemCount, fillerMaxLevel: ORDER_CONFIG.fillerMaxLevel, costPerTierBase: ORDER_CONFIG.costPerTierBase, orderChains: ORDER_CHAINS, dominantTier: ORDER_DOMINANT_TIER, reroll: ORDER_REROLL });
S('gearTuning', { fuse: gear.GEAR_FUSE, gen: gear.GEAR_GEN, level: gear.GEAR_LEVEL, chestTiers: gear.GEAR_CHEST_TIERS.map((t) => ({ maxDifficulty: Number.isFinite(t.maxDifficulty) ? t.maxDifficulty : null, rarity: t.rarity })) });
S('haptics', cfg.HAPTICS);
S('tierPresentation', cfg.TIER_PRESENTATION);
S('vfx', cfg.VFX_CONFIG);

// ── _global (well-known refs) + _id-ledger ──
S('global', {
  schemaVersion: 0,
  refs: {
    coinsResourceId: resId.coins, heroXpResourceId: resId.heroXp, gearXpResourceId: resId.gearXp, energyResourceId: resId.energy,
    ...Object.fromEntries(HERO_RARITY_ORDER.map((k) => [`crystal${k.replace(/^./, (c) => c.toUpperCase())}ResourceId`, crystalResId[k]])),
    starterHeroConfigId: heroId.knight,
  },
});
wr(GAME, '_id-ledger', ledger);

console.log('ported:', { chains: Object.keys(CHAINS).length, generators: Object.keys(GENERATORS).length, rarities: HERO_RARITY_ORDER.length, gearRarities: gear.GEAR_RARITY_ORDER.length, gearSlots: gear.GEAR_SLOTS.length, resources: rid - 1000, heroes: hid - 2000, enemies: eid - 3000, gearPieces: gid - 4000, zones: zid - 5000, banners: bid - 6000 });
