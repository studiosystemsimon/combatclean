#!/usr/bin/env node
/**
 * validate-edit-hook.mjs — blocking PreToolUse hook. When an Edit/Write/MultiEdit targets a
 * registry data file, it reconstructs the WOULD-BE file content, validates it against the same
 * Zod schema the CLI + build use, and exits 2 (blocking the write, error on stderr) on failure.
 * Non-registry paths exit 0 immediately.
 *
 * Wired in .claude/settings.json under hooks.PreToolUse (matcher: Edit|Write|MultiEdit).
 * Scope: per-file SHAPE validation (fast). Full cross-entity ref-integrity (dangling configRef /
 * missing assetId) is NOT checked here — run `node config/scaffold.mjs <registry> validate` after
 * a batch of edits (and the build gate enforces it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pass() { process.exit(0); }
function block(msg) { console.error(`[scaffold-hook] ✗ ${msg}`); process.exit(2); }

// ── read the PreToolUse payload from stdin ──
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let payload;
try { payload = JSON.parse(raw || '{}'); } catch { pass(); }

const tool = payload.tool_name;
const input = payload.tool_input ?? {};
const filePath = input.file_path;
if (!filePath || !['Edit', 'Write', 'MultiEdit'].includes(tool)) pass();

const rel = relative(ROOT, resolve(ROOT, filePath)).replace(/\\/g, '/');
const isConfig = rel.startsWith('src/data/config/game/') && rel.endsWith('.json');
const isUI = rel.startsWith('src/data/config/ui/') && rel.endsWith('.json');
const isVisual = rel.startsWith('src/data/visual-config/');
const isAssets = rel.startsWith('assets/') && basename(rel) === 'assets.json';
if (!isConfig && !isUI && !isVisual && !isAssets) pass();

// ── reconstruct the post-edit content ──
function applyEdit(text, { old_string, new_string, replace_all }) {
  if (replace_all) return text.split(old_string).join(new_string);
  const i = text.indexOf(old_string);
  return i === -1 ? text : text.slice(0, i) + new_string + text.slice(i + old_string.length);
}
let content;
if (tool === 'Write') content = input.content ?? '';
else {
  const cur = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const edits = tool === 'MultiEdit' ? (input.edits ?? []) : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }];
  content = edits.reduce((t, e) => applyEdit(t, e), cur);
}

// Ledger / singleton / global files (_global, _id-ledger, _<name>) aren't per-entity schema files —
// leave them to the build gate + `config validate`. Assets manifests are always basename "assets.json".
if (!isAssets && basename(rel).startsWith('_')) pass();

let data;
try { data = JSON.parse(content); } catch (e) { block(`${rel}: invalid JSON — ${e.message}`); }

// ── validate against the matching schema ──
try {
  if (isConfig) {
    const cat = rel.split('/')[4]; // src/data/config/game/<cat>/<file>
    const { CATEGORIES } = await import(resolve(ROOT, 'src/data/config/manifest.ts'));
    const c = CATEGORIES.find((x) => x.folder === cat || x.name === cat);
    if (!c) pass(); // unknown folder — not a category entity
    const r = c.schema.safeParse(data);
    if (!r.success) block(`config/${cat} ${rel}:\n  ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n  ')}`);
  } else if (isUI) {
    const { zUIConfig } = await import(resolve(ROOT, 'src/data/config/ui/ui-schema.ts'));
    const r = zUIConfig.safeParse(data);
    if (!r.success) block(`ui ${rel}:\n  ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n  ')}`);
  } else if (isVisual) {
    const { zVisualConfig } = await import(resolve(ROOT, 'src/view/combat/vsm/schema.ts'));
    const r = zVisualConfig.safeParse(data);
    if (!r.success) block(`visual ${rel}:\n  ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n  ')}`);
  } else if (isAssets) {
    await import('@bishop/asset-types-2d/schema'); // register the 2D asset schemas
    const { validateManifest } = await import('@bishop/asset-registry');
    const errs = validateManifest(data);
    if (errs.length) block(`assets ${rel}:\n  ${errs.map((e) => `${e.assetId ?? ''} ${e.message}`).join('\n  ')}`);
  }
} catch (e) {
  // A tooling failure must not silently allow a bad write — surface it, but don't hard-block on an
  // infra error (e.g. a schema import failing before its phase lands); report and let the build catch it.
  console.error(`[scaffold-hook] (warning) could not validate ${rel}: ${e.message}`);
  pass();
}

pass();
