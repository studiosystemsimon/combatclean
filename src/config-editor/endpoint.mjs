// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CONFIG EDITOR — dev-only endpoint (apply:'serve'). Serves the schema + current values of all three
// config registries to config-editor.html and writes edits back THROUGH THE REAL VALIDATOR.
//
// No parallel data path: it reads/writes the SAME JSON files the build reads, derives its forms from
// the SAME Zod schemas (z.toJSONSchema — the same conversion describeSchema + the ref index use), and
// gates every save with the SAME `validateMerged` the build + CLI run. An invalid edit is rejected and
// the file is never touched. After a valid write, Vite's gameConfigPlugin recomposes + HMRs the game.
//
// Wired in vite.config.ts (which already imports CATEGORIES + the UI/visual schemas, so they are passed
// in rather than re-imported from a .ts here) — see configEditorEndpoint({ ... }).
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { validateMerged, isSingletonCategory, isIdCategory, isKeyCategory } from '@bishop/config-registry';
import { scanConfigDir } from '@bishop/config-registry/node';
import { scanAssetsDir } from '@bishop/asset-registry/node';

const REF_META = { configRef: 'configRef', stringConfigRef: 'stringConfigRef', recordKeyRef: 'recordKeyRef' };

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : undefined);
// Atomic write: stage to a .tmp sibling then rename over the target. The rename is atomic, so Vite's
// config watcher never observes a truncated/partial file mid-write (which made compose() 500 on the
// re-bake). tabs + trailing NL (repo style).
const writeJson = (p, v) => {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(v, null, '\t')}\n`);
  renameSync(tmp, p);
};
const jsonSchema = (schema) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
const subdirs = (root) =>
  existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
const entityCats = (cats) => cats.filter((c) => !isSingletonCategory(c));
const singletonCats = (cats) => cats.filter((c) => isSingletonCategory(c));
const folderOf = (c) => c.folder ?? c.name;
const entryKey = (cat, e) => (isKeyCategory(cat) ? e[cat.keyField] : e.id);
const labelOf = (e) => e.displayName ?? e.name ?? undefined;

// Fold the singletons (_<name>.json) into a scanned entity merge → the full merged shape validateMerged
// (and the build's compose) expect. scanConfigDir deliberately skips singletons.
function buildMerged(gameDir, cats) {
  const merged = scanConfigDir(gameDir, cats);
  for (const c of singletonCats(cats)) {
    const v = readJson(join(gameDir, `_${c.name}.json`));
    if (v !== undefined) merged[c.name] = v;
  }
  return merged;
}

// Read a UI/visual registry dir → { category: { id|key: entry } }.
function readRegistry(root) {
  const out = {};
  for (const cat of subdirs(root)) {
    out[cat] = {};
    for (const f of readdirSync(join(root, cat)).filter((n) => n.endsWith('.json'))) {
      const e = readJson(join(root, cat, f));
      if (e && typeof e === 'object') out[cat][String(e.id ?? e.key)] = e;
    }
  }
  return out;
}

// Ref-picker options per non-singleton category: { category: [{ id, key, label }] }.
function buildOptions(merged, cats) {
  const options = {};
  for (const c of entityCats(cats)) {
    const arr = Array.isArray(merged[c.name]) ? merged[c.name] : [];
    options[c.name] = arr.map((e) => ({
      id: isIdCategory(c) ? e.id : null,
      key: isKeyCategory(c) ? e[c.keyField] : null,
      label: labelOf(e) ?? String(entryKey(c, e)),
    }));
  }
  return options;
}

// Zod safeParse → flat `path: message` error lines (matching validateMerged's readable style).
function parseErrors(schema, value) {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

// Collect every *AssetId / *AssetIds value at any depth (mirrors compose()'s collectAssetRefs) — the
// build's asset-ref integrity gate, replicated so a ui/visual save can't write a dangling asset ref.
function collectAssetRefs(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectAssetRefs(n, out); return; }
  for (const [k, v] of Object.entries(node)) {
    if (/AssetIds?$/.test(k)) { for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string' && id) out.push(id); }
    else collectAssetRefs(v, out);
  }
}

const sendJson = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

export function configEditorEndpoint({ gameDir, uiDir, visualDir, assetsRoot, categories, uiSchema, visualSchema }) {
  // ── GET /__config/manifest — schemas (as JSON Schema) + ref-picker options ──
  const handleManifest = (_req, res) => {
    const merged = buildMerged(gameDir, categories);
    sendJson(res, 200, {
      registries: {
        logical: {
          singletons: singletonCats(categories).map((c) => ({ name: c.name, schema: jsonSchema(c.schema) })),
          entities: entityCats(categories).map((c) => ({
            name: c.name, kind: c.kind, keyField: c.keyField ?? null, schema: jsonSchema(c.schema),
          })),
        },
        ui: { schema: jsonSchema(uiSchema), categories: subdirs(uiDir) },
        visual: { schema: jsonSchema(visualSchema), categories: subdirs(visualDir) },
      },
      refMeta: REF_META,
      options: buildOptions(merged, categories),
    });
  };

  // ── GET /__config/values — current values across the three registries ──
  const handleValues = (_req, res) => {
    const merged = buildMerged(gameDir, categories);
    const singletons = {};
    for (const c of singletonCats(categories)) singletons[c.name] = merged[c.name] ?? null;
    const entities = {};
    for (const c of entityCats(categories)) entities[c.name] = Array.isArray(merged[c.name]) ? merged[c.name] : [];
    sendJson(res, 200, {
      logical: { singletons, entities },
      ui: readRegistry(uiDir),
      visual: readRegistry(visualDir),
    });
  };

  // ── POST /__config/save — validate against the REAL schema/gate, then write ──
  const handleSave = async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, errors: ['POST only'] });
    const { registry, kind, category, id, value } = await readBody(req);
    if (!value || typeof value !== 'object') return sendJson(res, 400, { ok: false, errors: ['missing value'] });

    if (registry === 'logical') {
      const cat = categories.find((c) => c.name === category);
      if (!cat) return sendJson(res, 400, { ok: false, errors: [`unknown category "${category}"`] });
      // Build the full merged config with THIS edit applied, then run the real build gate over it.
      const merged = buildMerged(gameDir, categories);
      if (kind === 'singleton') {
        merged[cat.name] = value;
      } else {
        const arr = (Array.isArray(merged[cat.name]) ? merged[cat.name] : []).slice();
        const idx = arr.findIndex((e) => String(entryKey(cat, e)) === String(id));
        if (idx < 0) return sendJson(res, 400, { ok: false, errors: [`entry "${id}" not found in ${category}`] });
        arr[idx] = value;
        merged[cat.name] = arr;
      }
      const errors = [...parseErrors(cat.schema, value), ...validateMerged(merged, categories).errors];
      if (errors.length) return sendJson(res, 200, { ok: false, errors });
      // Write: singleton → _<name>.json; entity → overwrite the existing <id|key> file (preserve its name).
      if (kind === 'singleton') {
        writeJson(join(gameDir, `_${cat.name}.json`), value);
      } else {
        const dir = join(gameDir, folderOf(cat));
        const file = readdirSync(dir)
          .filter((n) => n.endsWith('.json') && !n.startsWith('_'))
          .find((n) => String(entryKey(cat, readJson(join(dir, n)))) === String(id));
        if (!file) return sendJson(res, 400, { ok: false, errors: [`file for "${id}" not found in ${folderOf(cat)}`] });
        writeJson(join(dir, file), value);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (registry === 'ui' || registry === 'visual') {
      const root = registry === 'ui' ? uiDir : visualDir;
      const schema = registry === 'ui' ? uiSchema : visualSchema;
      // Parity with compose(): the entry's id/key must correspond to an existing LOGICAL entry.
      const cat = categories.find((c) => c.name === category);
      if (!cat || isSingletonCategory(cat)) return sendJson(res, 400, { ok: false, errors: [`unknown entity category "${category}"`] });
      const merged = buildMerged(gameDir, categories);
      const known = new Set((Array.isArray(merged[cat.name]) ? merged[cat.name] : []).map((e) => String(entryKey(cat, e))));
      if (!known.has(String(id))) return sendJson(res, 400, { ok: false, errors: [`${registry}: id/key "${id}" has no logical entry in ${category}`] });
      const errors = parseErrors(schema, value);
      // Asset-ref integrity — the same gate compose() runs: every *AssetId must resolve, else the next
      // recompose/build would throw. Enforce it here so a save can't write a dangling asset reference.
      if (assetsRoot) {
        const refs = [];
        collectAssetRefs(value, refs);
        const assetIds = new Set(scanAssetsDir(assetsRoot).registry.keys());
        for (const id of refs) if (!assetIds.has(id)) errors.push(`unresolved asset reference "${id}"`);
      }
      if (errors.length) return sendJson(res, 200, { ok: false, errors });
      const dir = join(root, category);
      mkdirSync(dir, { recursive: true });
      // Overwrite the existing file if present (match by id/key), else create <id|key>.json.
      const existing = existsSync(dir)
        ? readdirSync(dir).filter((n) => n.endsWith('.json')).find((n) => { const e = readJson(join(dir, n)); return String(e?.id ?? e?.key) === String(id); })
        : null;
      writeJson(join(dir, existing ?? `${id}.json`), value);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 400, { ok: false, errors: [`unknown registry "${registry}"`] });
  };

  const routes = [
    ['/__config/manifest', handleManifest],
    ['/__config/values', handleValues],
    ['/__config/save', handleSave],
  ];

  return {
    name: 'config-editor-endpoint',
    apply: 'serve',
    configureServer(server) {
      for (const [path, handler] of routes) {
        server.middlewares.use(path, (req, res) => {
          Promise.resolve(handler(req, res)).catch((e) => {
            if (!res.writableEnded) sendJson(res, 500, { ok: false, errors: [String(e)] });
          });
        });
      }
    },
  };
}

export default configEditorEndpoint;
