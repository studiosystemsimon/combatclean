/**
 * config registry — the gameplay LOGICAL config. Engine = @bishop/config-registry over the
 * CATEGORIES manifest (the SAME engine the build + edit hook use). Format-info goes through the
 * shared describeSchema helper.
 *
 * Data:   src/data/config/game/<category>/*.json     (id-kind: <id>-<slug>.json; key-kind: <key>.json)
 *         src/data/config/game/_<name>.json          (singleton categories)
 * Schema: src/data/config/manifest.ts (CATEGORIES)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidMerged, buildInspectContext, buildRefIndex, expand, findRefs,
  formatFields, isIdCategory, isSingletonCategory, lintRefNaming,
} from '@bishop/config-registry';
import { scanConfigDir, createEntity, writeEntity } from '@bishop/config-registry/node';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GAME_DIR = join(ROOT, 'src/data/config/game');
const { CATEGORIES } = await import(join(ROOT, 'src/data/config/manifest.ts'));
const byName = new Map(CATEGORIES.map((c) => [c.name, c]));

function die(m) { console.error(m); process.exit(1); }

// Merge per-entity folders (scanConfigDir) AND fold in singleton values from _<name>.json —
// scanConfigDir skips singletons by design, so we compose them here so validate/expand/refs see them.
function merged() {
  const m = scanConfigDir(GAME_DIR, CATEGORIES);
  for (const c of CATEGORIES) {
    if (!isSingletonCategory(c)) continue;
    const p = join(GAME_DIR, `_${c.name}.json`);
    if (existsSync(p)) m[c.name] = JSON.parse(readFileSync(p, 'utf-8'));
  }
  return m;
}
function ctx() { return buildInspectContext(merged(), CATEGORIES, buildRefIndex(CATEGORIES)); }
function numId(raw) { const id = Number(raw); if (Number.isNaN(id)) die(`expected numeric id, got "${raw}"`); return id; }

export function list(cat) {
  const m = merged();
  if (cat) {
    if (!byName.has(cat)) die(`Unknown category "${cat}" (run: config list)`);
    const c = byName.get(cat);
    const arr = Array.isArray(m[cat]) ? m[cat] : [];
    if (isSingletonCategory(c)) return console.log(`${cat} — singleton:\n${JSON.stringify(m[cat] ?? {}, null, 2)}`);
    console.log(`${cat} — ${arr.length} entries:`);
    for (const e of arr) {
      const ident = isIdCategory(c) ? `#${e.id}` : `"${e[c.keyField]}"`;
      console.log(`  ${ident.padEnd(8)} ${e.displayName ?? ''}`);
    }
    return;
  }
  console.log('config categories (src/data/config/game/**):\n');
  for (const c of CATEGORIES) {
    const n = Array.isArray(m[c.name]) ? m[c.name].length : (isSingletonCategory(c) ? 1 : 0);
    console.log(`  ${c.name.padEnd(20)} ${String(n).padStart(4)} ${isSingletonCategory(c) ? 'singleton' : `entries   ${c.kind}`}`);
  }
  console.log('\nInspect: list <cat> | fields <cat> | show <cat> <id> | expand <cat> <id> | refs <cat> <id> | validate | lint');
}

export function fields(cat) {
  const c = byName.get(cat);
  if (!c) die(`Unknown category "${cat}"`);
  console.log(formatFields(c.schema, `${cat} — Zod schema`));
}

export function show(cat, raw) {
  const c = byName.get(cat);
  if (!c) die(`Unknown category "${cat}"`);
  if (isSingletonCategory(c)) return console.log(JSON.stringify(merged()[cat] ?? {}, null, 2));
  const e = (merged()[cat] || []).find((x) => String(x.id) === String(raw) || String(x[c.keyField]) === String(raw));
  if (!e) die(`no ${cat} "${raw}"`);
  console.log(JSON.stringify(e, null, 2));
}

// expand/refs are id-kind only — config ids are globally unique, so no category is needed.
export function expandEntry(raw) {
  const t = expand(numId(raw), ctx());
  if (!t) die(`no entity #${raw}`);
  console.log(JSON.stringify(t, null, 2));
}

export function refs(raw) {
  const id = numId(raw);
  const c = ctx();
  const hits = findRefs(id, c);
  const label = c.byId.get(id)?.displayName ?? id;
  if (!hits.length) return console.log(`#${id} "${label}" — referenced by nothing.`);
  console.log(`#${id} "${label}" — referenced by ${hits.length}:`);
  for (const h of hits) console.log(`  ${h.category.padEnd(16)} #${h.fromId ?? h.fromKey}  via ${h.keys.join(', ')}`);
}

export function validate() {
  try { assertValidMerged(merged(), CATEGORIES); console.log('✓ config valid'); }
  catch (err) { die(String(err?.message ?? err)); }
}

export function lint() {
  const v = lintRefNaming(CATEGORIES);
  if (!v.length) return console.log('✓ ref naming clean (*ConfigId/*ConfigIds)');
  for (const x of v) console.error(`  ${x}`);
  die('');
}

/** Pure create — writes one logical-config entity. Returns { ok, error?, id?, path?, displayName? }
 *  and NEVER exits/prints, so the CLI and a future editor endpoint share ONE code path. */
export function createEntry({ category, sets, name } = {}) {
  const c = byName.get(category);
  if (!c) return { ok: false, error: `Unknown category "${category}"` };
  if (isSingletonCategory(c)) return { ok: false, error: `"${category}" is a singleton — edit src/data/config/game/_${category}.json directly` };
  const overrides = { ...(sets ?? {}) };
  if (name) overrides.displayName = name;
  let entity, m;
  try { ({ entity, merged: m } = createEntity(GAME_DIR, CATEGORIES, category, overrides)); }
  catch (err) { return { ok: false, error: String(err?.message ?? err) }; }
  const candidate = { ...m, [category]: [...(m[category] ?? []), entity] };
  try { assertValidMerged(candidate, CATEGORIES); }
  catch (err) { return { ok: false, error: `validation failed — nothing written: ${String(err?.message ?? err).split('\n').slice(0, 8).join(' ')}` }; }
  writeEntity(GAME_DIR, CATEGORIES, category, entity);
  const ident = isIdCategory(c) ? entity.id : entity[c.keyField];
  return { ok: true, id: ident, displayName: entity.displayName, path: `src/data/config/game/${c.folder}/` };
}

export function create(cat, _unused, opts) {
  const r = createEntry({ category: cat, sets: opts?.sets, name: opts?.name });
  if (!r.ok) die(`✗ ${r.error}`);
  const ident = typeof r.id === 'number' ? `#${r.id}` : `"${r.id}"`;
  console.log(`✓ created config ${cat} ${ident} "${r.displayName}" → ${r.path}`);
  console.log('  Edit the file directly to fill it in — the edit hook re-validates on save.');
}
