#!/usr/bin/env node
/**
 * export-to-game.mjs — wire the trim tool's 256×256 hero exports into the combatclean game.
 *
 * For every trim/assets/heroes/<slug>_256.png:
 *   1. copy it to assets/combatclean/heroes/<slug>.png            (the in-game art)
 *   2. ensure assets/combatclean/assets.json has  "hero.<slug>": { type:"image", file:"heroes/<slug>.png" }
 *   3. LOGICAL entry:
 *        - existing hero (displayName === slug)  -> leave config, just refreshed the art
 *        - new slug -> create via the sanctioned scaffold CLI (auto-allocates the id in the 2000 lane),
 *          with a valid placeholder stat block (tagged origin=char-art-export) for the operator to tune
 *   4. UI entry src/data/config/ui/heroes/<id>.json (name + iconAssetId + emoji + abilityNames) if missing
 *   5. gate: game-config:validate + assets:validate  (+ build unless --no-build)
 *
 * Never edits existing logical/UI entries (only refreshes art). New-hero STATS are placeholders —
 * balance is the operator's to tune in the data (that's the "all tuning is data" contract).
 *
 * Usage: node export-to-game.mjs [--no-build] [--only <slug>]
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const PIPELINE = dirname(fileURLToPath(import.meta.url));           // tools/char-art-pipeline
const GAME = resolve(PIPELINE, '..', '..');                        // combatclean repo root
const HEROES_SRC = join(PIPELINE, 'trim', 'assets', 'heroes');
const GAME_ART = join(GAME, 'assets', 'combatclean', 'heroes');
const ASSETS_JSON = join(GAME, 'assets', 'combatclean', 'assets.json');
const GAME_HEROES = join(GAME, 'src', 'data', 'config', 'game', 'heroes');
const UI_HEROES = join(GAME, 'src', 'data', 'config', 'ui', 'heroes');
const META_JSON = join(PIPELINE, 'trim', 'assets', 'trim_meta.json');

// registration points (normalized {x,y}) saved by the tool -> asset `anchor`
let META = { images: {} };
try { META = JSON.parse(readFileSync(META_JSON, 'utf8')); } catch {}
function anchorFor(slug) {
  const rec = (META.images || {})[`heroes/${slug}.png`];
  if (rec && Array.isArray(rec.reg) && rec.reg.length === 2) {
    const clamp = (v) => Math.max(0, Math.min(1, Number(v)));
    return { x: clamp(rec.reg[0]), y: clamp(rec.reg[1]) };
  }
  return null;
}
function portraitFor(slug) {
  const rec = (META.images || {})[`heroes/${slug}.png`];
  const pr = rec && rec.portrait;
  if (pr && (pr.scale != null || pr.x != null || pr.y != null)) {
    const p = {}; ['scale', 'x', 'y'].forEach(k => { if (pr[k] != null) p[k] = Number(pr[k]); });
    return Object.keys(p).length ? p : null;
  }
  return null;
}

const args = process.argv.slice(2);
const NO_BUILD = args.includes('--no-build');
const DRY = args.includes('--dry-run');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const log = (...a) => console.log(...a);
const title = (s) => s.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');

function weaponChainFor(slug) {
  const s = slug.toLowerCase();
  if (/(archer|ranger|hunter|gunslinger|sniper|marksman|bow|arblast|crossbow|pirate)/.test(s)) return 'bow';
  if (/(mage|wizard|sorcer|warlock|witch|necro|druid|cleric|priest|shaman|summoner|geomancer|spell|alchemist|inquisitor|warlock)/.test(s)) return 'magic';
  return 'blade';
}
const EMOJI = { bow: '🏹', magic: '🔮', blade: '⚔️' };

// ---- discover work ----
if (!existsSync(HEROES_SRC)) { console.error('no heroes source dir:', HEROES_SRC); process.exit(1); }
let slugs = readdirSync(HEROES_SRC)
  .filter(f => f.endsWith('_256.png'))
  .map(f => f.slice(0, -('_256.png'.length)));
if (ONLY) slugs = slugs.filter(s => s === ONLY);
slugs.sort();
if (!slugs.length) { log('RESULT ' + JSON.stringify({ ok: true, refreshed: [], created: [], errors: [], note: 'no *_256.png found' })); process.exit(0); }

// existing logical heroes: displayName -> id
const existing = {};
for (const f of readdirSync(GAME_HEROES).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
  try { const d = JSON.parse(readFileSync(join(GAME_HEROES, f), 'utf8')); if (d.displayName) existing[d.displayName] = d.id; } catch {}
}

if (DRY) {
  const plan = { refresh: [], create: [] };
  for (const slug of slugs) (existing[slug] != null ? plan.refresh : plan.create).push(slug);
  log('[dry-run] would REFRESH (existing): ' + (plan.refresh.join(', ') || '(none)'));
  log('[dry-run] would CREATE (new):     ' + (plan.create.join(', ') || '(none)'));
  log('RESULT ' + JSON.stringify({ ok: true, dryRun: true, refreshed: plan.refresh, created: plan.create, errors: [] }));
  process.exit(0);
}

const assets = JSON.parse(readFileSync(ASSETS_JSON, 'utf8'));
assets.assets ||= {};

const refreshed = [], created = [], errors = []; let anchored = 0, portraited = 0;

for (const slug of slugs) {
  try {
    // 1. copy art
    copyFileSync(join(HEROES_SRC, `${slug}_256.png`), join(GAME_ART, `${slug}.png`));
    // 2. asset entry (+ registration point -> anchor, if set)
    const anchor = anchorFor(slug);
    if (anchor) anchored++;
    const portrait = portraitFor(slug);
    assets.assets[`hero.${slug}`] = { type: 'image', file: `heroes/${slug}.png`, ...(anchor ? { anchor } : {}) };

    let id = existing[slug];
    if (id != null) {
      refreshed.push({ slug, id });
      log(`refreshed  ${slug} (id ${id}) — art + asset`);
    } else {
      // 3. new logical entry via the scaffold CLI (auto id + ledger bump)
      const chain = weaponChainFor(slug);
      execFileSync('node', ['config/scaffold.mjs', 'config', 'create', 'heroes',
        '--name', slug,
        '--set', 'rarityKey=rare',
        '--set', `weaponChainKey=${chain}`,
        '--set', 'baseAtk=16',
        '--set', 'baseHp=160',
        '--set', 'normal=' + JSON.stringify({ chargeMs: 6000, effect: { type: 'burst', mult: 2 } }),
        '--set', 'limit=' + JSON.stringify({ orders: 5, effect: { type: 'burst', mult: 5 } }),
        '--set', 'tags=' + JSON.stringify({ origin: 'char-art-export', tuning: 'placeholder' }),
      ], { cwd: GAME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      // find the id the scaffold allocated
      const nf = readdirSync(GAME_HEROES).find(f => f.endsWith(`-${slug}.json`));
      id = nf ? JSON.parse(readFileSync(join(GAME_HEROES, nf), 'utf8')).id : null;
      if (id == null) throw new Error('scaffold did not produce a logical entry');
      // 4. UI entry
      const emoji = EMOJI[chain] || '⚔️';
      writeFileSync(join(UI_HEROES, `${id}.json`), JSON.stringify({
        id, name: title(slug), iconAssetId: `hero.${slug}`, emoji,
        abilityNames: { basic: 'Attack', normal: 'Skill', limit: 'Ultimate' },
        ...(portrait ? { portrait } : {}),
      }, null, '\t') + '\n');
      created.push({ slug, id, chain });
      log(`created    ${slug} (id ${id}, ${chain}) — logical + ui + asset [placeholder stats]`);
    }

    // ensure a UI entry exists for pre-existing heroes too (safety; won't overwrite)
    if (existing[slug] != null && !existsSync(join(UI_HEROES, `${id}.json`))) {
      const chain = weaponChainFor(slug);
      writeFileSync(join(UI_HEROES, `${id}.json`), JSON.stringify({
        id, name: title(slug), iconAssetId: `hero.${slug}`, emoji: EMOJI[chain] || '⚔️',
        abilityNames: { basic: 'Attack', normal: 'Skill', limit: 'Ultimate' },
      }, null, '\t') + '\n');
    }

    // patch the portrait framing into the UI entry (existing or just-created)
    if (portrait && id != null) {
      const uiPath = join(UI_HEROES, `${id}.json`);
      let ui = {}; try { ui = JSON.parse(readFileSync(uiPath, 'utf8')); } catch {}
      ui.portrait = portrait;
      if (ui.id == null) ui.id = id;
      if (ui.name == null) ui.name = title(slug);
      writeFileSync(uiPath, JSON.stringify(ui, null, '\t') + '\n');
      portraited++;
    }
  } catch (e) {
    const msg = (e.stderr || e.message || String(e)).toString().trim().split('\n').slice(-3).join(' ');
    errors.push({ slug, error: msg });
    log(`ERROR      ${slug}: ${msg}`);
  }
}

// 5. write assets.json back (tab-indented, matching the repo style)
writeFileSync(ASSETS_JSON, JSON.stringify(assets, null, '\t') + '\n');
log(`\nassets.json updated (${refreshed.length} refreshed, ${created.length} created)`);

// ---- gates ----
function run(cmd, argv) {
  try { const out = execFileSync(cmd, argv, { cwd: GAME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, out }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}
log('\n=== game-config:validate ==='); const v1 = run('node', ['config/scaffold.mjs', 'config', 'validate']); log(v1.out.trim());
log('=== assets:validate ===');       const v2 = run('node', ['config/scaffold.mjs', 'assets', 'validate']); log(v2.out.trim());
let build = { ok: null, out: '(skipped)' };
if (!NO_BUILD) { log('=== npm run build (compose gate) ==='); build = run('npm', ['run', 'build']); log(build.out.trim().split('\n').slice(-8).join('\n')); }

const ok = v1.ok && v2.ok && (build.ok !== false);
log('\nRESULT ' + JSON.stringify({
  ok, refreshed: refreshed.map(r => r.slug), created: created.map(c => c.slug), anchored, portraited,
  errors, validate: { config: v1.ok, assets: v2.ok }, build: build.ok,
}));
process.exit(ok ? 0 : 1);
