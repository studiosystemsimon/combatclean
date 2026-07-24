// === CATEGORIES — the content-format manifest (the contract SSOT) ===
//
// The one file the config-registry engine is generic over. Every logical-config category: kind
// (id / key / singleton), folder under config/game/, Zod schema, and (id-kind) its never-reuse id
// lane. The build (virtual:game-config), the scaffold CLI, and the edit hook ALL read this. Categories
// mirror MergeCombat's systems. Node strips TS types on import, so .mjs scripts import this directly.
import type { ConfigCategory } from '@bishop/config-registry';

import { zChainConfig } from './schemas/chains.ts';
import { zGeneratorConfig } from './schemas/generators.ts';
import { zRarityConfig } from './schemas/rarities.ts';
import { zGearRarityConfig } from './schemas/gearRarities.ts';
import { zGearSlotConfig } from './schemas/gearSlots.ts';
import { zResourceConfig } from './schemas/resources.ts';
import { zHeroConfig } from './schemas/heroes.ts';
import { zEnemyConfig } from './schemas/enemies.ts';
import { zGearPieceConfig } from './schemas/gearPieces.ts';
import { zZoneConfig } from './schemas/zones.ts';
import { zBannerConfig } from './schemas/banners.ts';
import {
  zBoardConfig, zEnergyConfig, zBattleConfig, zHeroCombatConfig, zLevelScalingConfig, zNodeConfig,
  zAfkConfig, zCrystalDropConfig, zUniqueDropConfig, zProgressionConfig, zOrdersConfig,
  zGearTuningConfig, zHapticsConfig, zTierPresentationConfig, zVfxConfig,
} from './schemas/singletons.ts';

export const CATEGORIES: ConfigCategory[] = [
  // ── key-kind (coded-enum content; slug key; extend alongside the code that gives a key meaning) ──
  { kind: 'key', name: 'chains', folder: 'chains', schema: zChainConfig, keyField: 'key' },
  { kind: 'key', name: 'generators', folder: 'generators', schema: zGeneratorConfig, keyField: 'key' },
  { kind: 'key', name: 'rarities', folder: 'rarities', schema: zRarityConfig, keyField: 'key' },
  { kind: 'key', name: 'gearRarities', folder: 'gearRarities', schema: zGearRarityConfig, keyField: 'key' },
  { kind: 'key', name: 'gearSlots', folder: 'gearSlots', schema: zGearSlotConfig, keyField: 'key' },

  // ── id-kind (data-only extensible; numeric id = identity; account-referenceable) ──
  { kind: 'id', name: 'resources', folder: 'resources', schema: zResourceConfig, idRange: [1000, 1999] },
  { kind: 'id', name: 'heroes', folder: 'heroes', schema: zHeroConfig, idRange: [2000, 2999] },
  { kind: 'id', name: 'enemies', folder: 'enemies', schema: zEnemyConfig, idRange: [3000, 3999] },
  { kind: 'id', name: 'gearPieces', folder: 'gearPieces', schema: zGearPieceConfig, idRange: [4000, 4999] },
  { kind: 'id', name: 'zones', folder: 'zones', schema: zZoneConfig, idRange: [5000, 5999] },
  { kind: 'id', name: 'banners', folder: 'banners', schema: zBannerConfig, idRange: [6000, 6999] },

  // ── singleton (one game-global tuning object each; validated by the same engine) ──
  { kind: 'singleton', name: 'board', schema: zBoardConfig },
  { kind: 'singleton', name: 'energy', schema: zEnergyConfig },
  { kind: 'singleton', name: 'battle', schema: zBattleConfig },
  { kind: 'singleton', name: 'heroCombat', schema: zHeroCombatConfig },
  { kind: 'singleton', name: 'levelScaling', schema: zLevelScalingConfig },
  { kind: 'singleton', name: 'node', schema: zNodeConfig },
  { kind: 'singleton', name: 'afk', schema: zAfkConfig },
  { kind: 'singleton', name: 'crystalDrop', schema: zCrystalDropConfig },
  { kind: 'singleton', name: 'uniqueDrop', schema: zUniqueDropConfig },
  { kind: 'singleton', name: 'progression', schema: zProgressionConfig },
  { kind: 'singleton', name: 'orders', schema: zOrdersConfig },
  { kind: 'singleton', name: 'gearTuning', schema: zGearTuningConfig },
  { kind: 'singleton', name: 'haptics', schema: zHapticsConfig },
  { kind: 'singleton', name: 'tierPresentation', schema: zTierPresentationConfig },
  { kind: 'singleton', name: 'vfx', schema: zVfxConfig },
];
