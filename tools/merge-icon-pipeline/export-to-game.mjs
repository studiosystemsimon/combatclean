#!/usr/bin/env node
/**
 * export-to-game.mjs — wire the trim tool's merge-icon exports into the combatclean game.
 * Mirrors ../char-art-pipeline/export-to-game.mjs, for the merge chains (magic / blade / range).
 *
 * For each chain, for each tier PNG (`<chain>/<chain>-<T>_256.png`, T = 1..N):
 *   1. copy it → assets/combatclean/merge/<chain>-<gameTier>.png   (gameTier = T-1, the 0-indexed game ladder)
 *   2. write the assets.json entry `<chain>.<gameTier>` = { type:image, file, anchor(reg), scale, rotation }
 *      reading the trim tool's per-icon params from trim_meta.json:
 *         reg → anchor (registration point; merge default = tile CENTRE [0.5,0.5])
 *         combat.scale → scale        combat.rot → rotation
 * Generator bench icons (gen.<chain>) are NOT part of this pipeline — kept as-is (gen-bow renamed to
 * gen-range by the bow→range migration). Non-merge assets in assets.json are untouched.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve as presolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PIPELINE = dirname(fileURLToPath(import.meta.url));            // tools/merge-icon-pipeline
const GAME = presolve(PIPELINE, '..', '..');                        // repo root
const TRIM = presolve(PIPELINE, '..', 'char-art-pipeline', 'trim', 'assets');
const META = JSON.parse(readFileSync(join(TRIM, 'trim_meta.json'), 'utf8')).images || {};
const ASSETS_JSON = join(GAME, 'assets', 'combatclean', 'assets.json');
const MERGE_DIR = join(GAME, 'assets', 'combatclean', 'merge');

const CHAINS = ['magic', 'blade', 'range']; // game chains (post bow→range migration)
const TIERS = 8;                            // 8-tier ladders (game tier = pipeline tier - 1)

const assets = JSON.parse(readFileSync(ASSETS_JSON, 'utf8'));
assets.assets ||= {};

// Drop every existing merge tier entry (blade.*, bow.*, magic.*, range.*) — we re-author them below.
for (const k of Object.keys(assets.assets)) {
  if (/^(blade|bow|magic|range)\.\d+$/.test(k)) delete assets.assets[k];
}

const out = { copied: [], missing: [] };
for (const chain of CHAINS) {
  for (let T = 1; T <= TIERS; T++) {
    const gameTier = T - 1;
    const src = join(TRIM, chain, `${chain}-${T}_256.png`);
    if (!existsSync(src)) { out.missing.push(`${chain}-${T}_256.png`); continue; }
    copyFileSync(src, join(MERGE_DIR, `${chain}-${gameTier}.png`));
    const m = META[`${chain}/${chain}-${T}.png`] || {};
    const reg = Array.isArray(m.reg) ? m.reg : [0.5, 0.5];        // merge reg default = tile centre
    const scale = (m.combat && m.combat.scale != null) ? m.combat.scale : 1;
    const rot = (m.combat && m.combat.rot != null) ? m.combat.rot : 0;
    const entry = { type: 'image', file: `merge/${chain}-${gameTier}.png`, anchor: { x: reg[0], y: reg[1] } };
    if (scale !== 1) entry.scale = scale;
    if (rot !== 0) entry.rotation = rot;
    assets.assets[`${chain}.${gameTier}`] = entry;
    out.copied.push(`${chain}.${gameTier}  (scale ${scale}, rot ${rot}, reg ${reg.join(',')})`);
  }
}

writeFileSync(ASSETS_JSON, `${JSON.stringify(assets, null, '\t')}\n`);
console.log('copied:\n  ' + out.copied.join('\n  '));
if (out.missing.length) console.log('MISSING sources:\n  ' + out.missing.join('\n  '));
console.log(`\n${out.copied.length} merge icons transferred to gameplay.`);
