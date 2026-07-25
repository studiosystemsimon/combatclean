#!/usr/bin/env node
/**
 * export-to-game.mjs — wire the trim tool's 256×256 exports into the combatclean game.
 *
 * Category-aware. For every trim/assets/<cat>/<slug>_256.png (cat = heroes | enemies):
 *   1. copy it to assets/combatclean/<cat>/<slug>.png                 (the in-game art)
 *   2. ensure assets.json  "<prefix>.<slug>": { type:"image", file:"<cat>/<slug>.png", anchor? }
 *   3. LOGICAL entry: existing (displayName === slug) → refresh art only; new → create via the
 *      sanctioned scaffold CLI (auto-allocates the id in the category lane) with a VALID PLACEHOLDER
 *      stat block (tagged origin=char-art-export) for the operator to tune.
 *   4. UI entry src/data/config/ui/<cat>/<id>.json (name + iconAssetId + emoji [+ abilityNames]).
 *      Heroes also get the tile `portrait` framing. Enemies have no tile → no portrait.
 *   5. gate: game-config:validate + assets:validate  (+ build unless --no-build)
 *
 * Registration points (reg) → the asset `anchor` (combat positions BOTH heroes and enemies by it).
 * Never edits existing logical entries; new stats are placeholders. Usage:
 *   node export-to-game.mjs [--no-build] [--dry-run] [--only <slug>] [--cat heroes|enemies]
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const PIPELINE = dirname(fileURLToPath(import.meta.url));           // tools/char-art-pipeline
const GAME = resolve(PIPELINE, '..', '..');                        // combatclean repo root
const ASSETS_JSON = join(GAME, 'assets', 'combatclean', 'assets.json');
const META_JSON = join(PIPELINE, 'trim', 'assets', 'trim_meta.json');

const args = process.argv.slice(2);
const NO_BUILD = args.includes('--no-build');
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const ONLY_CAT = args.includes('--cat') ? args[args.indexOf('--cat') + 1] : null;

const log = (...a) => console.log(...a);
const title = (s) => s.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
function weaponChainFor(slug) {
  const s = slug.toLowerCase();
  if (/(archer|ranger|hunter|gunslinger|sniper|marksman|bow|arblast|crossbow|pirate)/.test(s)) return 'bow';
  if (/(mage|wizard|sorcer|warlock|witch|necro|druid|cleric|priest|shaman|summoner|geomancer|spell|alchemist|inquisitor)/.test(s)) return 'magic';
  return 'blade';
}
const WEAPON_EMOJI = { bow: '🏹', magic: '🔮', blade: '⚔️' };

// ── per-category contract ──────────────────────────────────────────────────
const CATS = {
  heroes: {
    prefix: 'hero', dir: 'heroes', abilities: true, portrait: true, combat: true,
    gameArt: join(GAME, 'assets', 'combatclean', 'heroes'),
    logicalDir: join(GAME, 'src', 'data', 'config', 'game', 'heroes'),
    uiDir: join(GAME, 'src', 'data', 'config', 'ui', 'heroes'),
    newFor(slug) {
      const chain = weaponChainFor(slug);
      return { emoji: WEAPON_EMOJI[chain] || '⚔️', sets: [
        'rarityKey=rare', `weaponChainKey=${chain}`, 'baseAtk=16', 'baseHp=160',
        'normal=' + JSON.stringify({ chargeMs: 6000, effect: { type: 'burst', mult: 2 } }),
        'limit=' + JSON.stringify({ orders: 5, effect: { type: 'burst', mult: 5 } }),
        'tags=' + JSON.stringify({ origin: 'char-art-export', tuning: 'placeholder' }) ] };
    },
  },
  enemies: {
    prefix: 'enemy', dir: 'enemies', abilities: false, portrait: false, combat: true,
    gameArt: join(GAME, 'assets', 'combatclean', 'enemies'),
    logicalDir: join(GAME, 'src', 'data', 'config', 'game', 'enemies'),
    uiDir: join(GAME, 'src', 'data', 'config', 'ui', 'enemies'),
    newFor(_slug) {
      return { emoji: '👾', sets: [
        'hpMul=1', 'atkMul=1',
        'tags=' + JSON.stringify({ origin: 'char-art-export', tuning: 'placeholder' }) ] };
    },
  },
};

let META = { images: {} };
try { META = JSON.parse(readFileSync(META_JSON, 'utf8')); } catch {}
function metaRec(cat, slug) { return (META.images || {})[`${cat}/${slug}.png`]; }
function anchorFor(cat, slug) {
  const rec = metaRec(cat, slug);
  if (rec && Array.isArray(rec.reg) && rec.reg.length === 2) {
    const c = (v) => Math.max(0, Math.min(1, Number(v)));
    return { x: c(rec.reg[0]), y: c(rec.reg[1]) };
  }
  return null;
}
function portraitFor(cat, slug) {
  const rec = metaRec(cat, slug); const pr = rec && rec.portrait;
  if (pr && (pr.scale != null || pr.x != null || pr.y != null)) {
    const p = {}; ['scale', 'x', 'y'].forEach(k => { if (pr[k] != null) p[k] = Number(pr[k]); });
    return Object.keys(p).length ? p : null;
  }
  return null;
}
function combatFor(cat, slug) {   // in-combat / on-tile framing: SCALE (+ merge ROTATION). Position lives in the asset anchor = reg point.
  const rec = metaRec(cat, slug); const c = rec && rec.combat;
  if (c && (c.scale != null || c.rot != null)) {
    const o = {}; if (c.scale != null) o.scale = Number(c.scale); if (c.rot != null) o.rot = Number(c.rot);
    return Object.keys(o).length ? o : null;
  }
  return null;
}

function uiObject(cfg, id, slug, emoji, portrait, combat) {
  const o = { id, name: title(slug), iconAssetId: `${cfg.prefix}.${slug}`, emoji };
  if (cfg.abilities) o.abilityNames = { basic: 'Attack', normal: 'Skill', limit: 'Ultimate' };
  if (cfg.portrait && portrait) o.portrait = portrait;
  if (cfg.combat && combat) o.combat = combat;
  return o;
}

// every enemy-area category (+ the generic 'enemies') maps to the flat enemy config; 'heroes' → hero config
const ENEMY_CATS = new Set(['enemies', 'mossbog', 'gloomwood', 'boneyard', 'emberfall', 'frostvault', 'dragons-ascent']);
const cfgFor = (cat) => cat === 'heroes' ? CATS.heroes : (ENEMY_CATS.has(cat) ? CATS.enemies : null);

// ── discover work per category (any trim/assets subdir that maps to a config) ──
const ASSETS_ROOT = join(PIPELINE, 'trim', 'assets');
const catNames = readdirSync(ASSETS_ROOT).filter(c => {
  try { return statSync(join(ASSETS_ROOT, c)).isDirectory() && cfgFor(c) && (!ONLY_CAT || c === ONLY_CAT); }
  catch { return false; }
});
const work = {};   // cat -> [slugs]
for (const cat of catNames) {
  const src = join(ASSETS_ROOT, cat);
  if (!existsSync(src)) continue;
  let slugs = readdirSync(src).filter(f => f.endsWith('_256.png')).map(f => f.slice(0, -('_256.png'.length)));
  if (ONLY) slugs = slugs.filter(s => s === ONLY);
  slugs.sort();
  if (slugs.length) work[cat] = slugs;
}
if (!Object.keys(work).length) {
  log('RESULT ' + JSON.stringify({ ok: true, refreshed: [], created: [], errors: [], note: 'no *_256.png found' }));
  process.exit(0);
}

// existing logical displayName -> id, per category
const existing = {};
for (const cat of Object.keys(work)) {
  existing[cat] = {};
  for (const f of readdirSync(cfgFor(cat).logicalDir).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
    try { const d = JSON.parse(readFileSync(join(cfgFor(cat).logicalDir, f), 'utf8')); if (d.displayName) existing[cat][d.displayName] = d.id; } catch {}
  }
}

if (DRY) {
  const out = { ok: true, dryRun: true, refreshed: [], created: [], errors: [] };
  for (const cat of Object.keys(work)) for (const slug of work[cat])
    (existing[cat][slug] != null ? out.refreshed : out.created).push(`${cat}/${slug}`);
  log('[dry-run] REFRESH: ' + (out.refreshed.join(', ') || '(none)'));
  log('[dry-run] CREATE:  ' + (out.created.join(', ') || '(none)'));
  log('RESULT ' + JSON.stringify(out));
  process.exit(0);
}

const assets = JSON.parse(readFileSync(ASSETS_JSON, 'utf8'));
assets.assets ||= {};
const refreshed = [], created = [], errors = []; let anchored = 0, portraited = 0, combated = 0;

for (const cat of Object.keys(work)) {
  const cfg = cfgFor(cat);
  mkdirSync(cfg.uiDir, { recursive: true });
  for (const slug of work[cat]) {
    try {
      copyFileSync(join(PIPELINE, 'trim', 'assets', cat, `${slug}_256.png`), join(cfg.gameArt, `${slug}.png`));
      const anchor = anchorFor(cat, slug); if (anchor) anchored++;
      const portrait = cfg.portrait ? portraitFor(cat, slug) : null;
      const combat = cfg.combat ? combatFor(cat, slug) : null;
      assets.assets[`${cfg.prefix}.${slug}`] = { type: 'image', file: `${cfg.dir}/${slug}.png`, ...(anchor ? { anchor } : {}) };

      let id = existing[cat][slug];
      if (id != null) {
        refreshed.push(`${cat}/${slug}`);
        log(`refreshed  ${cat}/${slug} (id ${id}) — art + asset`);
      } else {
        const { emoji, sets } = cfg.newFor(slug);
        const setArgs = []; for (const s of sets) { setArgs.push('--set', s); }
        execFileSync('node', ['config/scaffold.mjs', 'config', 'create', cat, '--name', slug, ...setArgs],
          { cwd: GAME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const nf = readdirSync(cfg.logicalDir).find(f => f.endsWith(`-${slug}.json`));
        id = nf ? JSON.parse(readFileSync(join(cfg.logicalDir, nf), 'utf8')).id : null;
        if (id == null) throw new Error('scaffold did not produce a logical entry');
        writeFileSync(join(cfg.uiDir, `${id}.json`), JSON.stringify(uiObject(cfg, id, slug, emoji, portrait, combat), null, '\t') + '\n');
        created.push(`${cat}/${slug}`);
        log(`created    ${cat}/${slug} (id ${id}) — logical + ui + asset [placeholder stats]`);
      }

      // ensure a UI entry exists for pre-existing entries; patch portrait (heroes) / combat (enemies) if set
      const uiPath = join(cfg.uiDir, `${id}.json`);
      if (!existsSync(uiPath)) {
        const { emoji } = cfg.newFor(slug);
        writeFileSync(uiPath, JSON.stringify(uiObject(cfg, id, slug, emoji, portrait, combat), null, '\t') + '\n');
      } else {
        let ui = {}; try { ui = JSON.parse(readFileSync(uiPath, 'utf8')); } catch {}
        if (ui.id == null) ui.id = id; if (ui.name == null) ui.name = title(slug);
        ui.iconAssetId = `${cfg.prefix}.${slug}`; // self-heal the asset ref (always deterministic from the slug)
        if (cfg.portrait && portrait) ui.portrait = portrait;
        if (cfg.combat && combat) ui.combat = combat;
        writeFileSync(uiPath, JSON.stringify(ui, null, '\t') + '\n');
      }
      if (cfg.portrait && portrait) portraited++;
      if (cfg.combat && combat) combated++;
    } catch (e) {
      const msg = (e.stderr || e.message || String(e)).toString().trim().split('\n').slice(-3).join(' ');
      errors.push({ slug: `${cat}/${slug}`, error: msg });
      log(`ERROR      ${cat}/${slug}: ${msg}`);
    }
  }
}

writeFileSync(ASSETS_JSON, JSON.stringify(assets, null, '\t') + '\n');
log(`\nassets.json updated (${refreshed.length} refreshed, ${created.length} created)`);

// ---- gates ----
function run(cmd, argv) {
  try { return { ok: true, out: execFileSync(cmd, argv, { cwd: GAME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
log('\n=== game-config:validate ==='); const v1 = run('node', ['config/scaffold.mjs', 'config', 'validate']); log(v1.out.trim());
log('=== assets:validate ===');       const v2 = run('node', ['config/scaffold.mjs', 'assets', 'validate']); log(v2.out.trim());
let build = { ok: null, out: '(skipped)' };
if (!NO_BUILD) { log('=== npm run build (compose gate) ==='); build = run('npm', ['run', 'build']); log(build.out.trim().split('\n').slice(-8).join('\n')); }

const ok = v1.ok && v2.ok && (build.ok !== false);
log('\nRESULT ' + JSON.stringify({
  ok, refreshed, created, anchored, portraited, combated,
  errors, validate: { config: v1.ok, assets: v2.ok }, build: build.ok,
}));
process.exit(ok ? 0 : 1);
