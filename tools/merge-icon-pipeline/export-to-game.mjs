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
 * GENERATOR LADDERS (`<chain>-gen/<chain>-gen-<L>_256.png`, L = 1..GEN_LEVELS) are transferred the same
 * way into assets.json `gen.<chain>.<L>` (1-based, matching the in-game generator level) → asset dir
 * assets/combatclean/gen/. Non-merge/non-gen assets in assets.json are untouched.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as presolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PIPELINE = dirname(fileURLToPath(import.meta.url));            // tools/merge-icon-pipeline
const GAME = presolve(PIPELINE, '..', '..');                        // repo root
const TRIM = presolve(PIPELINE, '..', 'char-art-pipeline', 'trim', 'assets');
const META = JSON.parse(readFileSync(join(TRIM, 'trim_meta.json'), 'utf8')).images || {};
const ASSETS_JSON = join(GAME, 'assets', 'combatclean', 'assets.json');
const MERGE_DIR = join(GAME, 'assets', 'combatclean', 'merge');
const GEN_DIR = join(GAME, 'assets', 'combatclean', 'gen');
mkdirSync(GEN_DIR, { recursive: true });

const CHAINS = ['magic', 'blade', 'range']; // game chains (post bow→range migration)
const TIERS = 8;                            // 8-tier item ladders (game tier = pipeline tier - 1)
const GEN_LEVELS = 5;                       // generator ladders — 1-based (game gen level == pipeline tier)

const assets = JSON.parse(readFileSync(ASSETS_JSON, 'utf8'));
assets.assets ||= {};

// Drop existing merge tier entries (blade.N/bow.N/magic.N/range.N) + generator entries
// (gen.<chain>[.<L>], incl. legacy single-art gen.<chain>) — we re-author them below.
for (const k of Object.keys(assets.assets)) {
  if (/^(blade|bow|magic|range)\.\d+$/.test(k)) delete assets.assets[k];
  if (/^gen\.(blade|bow|magic|range)(\.\d+)?$/.test(k)) delete assets.assets[k];
}

// merge default reg = tile CENTRE; combat.scale/rot cook the on-tile size + spin.
const entryFrom = (metaKey, file) => {
  const m = META[metaKey] || {};
  const reg = Array.isArray(m.reg) ? m.reg : [0.5, 0.5];
  const scale = (m.combat && m.combat.scale != null) ? m.combat.scale : 1;
  const rot = (m.combat && m.combat.rot != null) ? m.combat.rot : 0;
  const entry = { type: 'image', file, anchor: { x: reg[0], y: reg[1] } };
  if (scale !== 1) entry.scale = scale;
  if (rot !== 0) entry.rotation = rot;
  return { entry, scale, rot, reg };
};

const out = { copied: [], missing: [] };
for (const chain of CHAINS) {
  // ── merge item ladder (0-indexed game tier) ──
  for (let T = 1; T <= TIERS; T++) {
    const gameTier = T - 1;
    const src = join(TRIM, chain, `${chain}-${T}_256.png`);
    if (!existsSync(src)) { out.missing.push(`${chain}-${T}_256.png`); continue; }
    copyFileSync(src, join(MERGE_DIR, `${chain}-${gameTier}.png`));
    const { entry, scale, rot, reg } = entryFrom(`${chain}/${chain}-${T}.png`, `merge/${chain}-${gameTier}.png`);
    assets.assets[`${chain}.${gameTier}`] = entry;
    out.copied.push(`${chain}.${gameTier}  (scale ${scale}, rot ${rot}, reg ${reg.join(',')})`);
  }
  // ── generator ladder (1-based game gen level) ──
  for (let L = 1; L <= GEN_LEVELS; L++) {
    const src = join(TRIM, `${chain}-gen`, `${chain}-gen-${L}_256.png`);
    if (!existsSync(src)) { out.missing.push(`${chain}-gen-${L}_256.png`); continue; }
    copyFileSync(src, join(GEN_DIR, `${chain}-${L}.png`));
    const { entry, scale, rot, reg } = entryFrom(`${chain}-gen/${chain}-gen-${L}.png`, `gen/${chain}-${L}.png`);
    assets.assets[`gen.${chain}.${L}`] = entry;
    out.copied.push(`gen.${chain}.${L}  (scale ${scale}, rot ${rot}, reg ${reg.join(',')})`);
  }
}

writeFileSync(ASSETS_JSON, `${JSON.stringify(assets, null, '\t')}\n`);
console.log('copied:\n  ' + out.copied.join('\n  '));
if (out.missing.length) console.log('MISSING sources:\n  ' + out.missing.join('\n  '));
console.log(`\n${out.copied.length} merge + generator icons transferred to gameplay.`);
// RESULT line — parsed by the trim tool's export poller (asset_tool_server.py → export_status).
console.log('RESULT ' + JSON.stringify({ refreshed: out.copied, created: [], anchored: out.copied.length, errors: out.missing.map((f) => ({ error: `missing source ${f}` })) }));
