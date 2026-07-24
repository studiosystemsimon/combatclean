/**
 * assets registry — the format-agnostic asset database. Engine = @bishop/asset-registry over the
 * assets/ tree. Format schemas + extractors come from @bishop/asset-types-2d (side-effect imports).
 * Composes the engine's existing exports (nothing forked): scanAssetsDir/validateAssetsDir (node),
 * getAssetSchema/listAssetTypes/validateDeclaration (root) + formatFields from config-registry.
 *
 * Data:   assets/**\/assets.json   (per-pack manifests) + assets/aliases.json (game-name → assetId)
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFields } from '@bishop/config-registry';
import { getAssetSchema, listAssetTypes, validateDeclaration } from '@bishop/asset-registry';
import { scanAssetsDir, validateAssetsDir } from '@bishop/asset-registry/node';
import '@bishop/asset-types-2d';        // register runtime extractors
import '@bishop/asset-types-2d/schema'; // register authoring schemas

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS_ROOT = join(ROOT, 'assets');
function die(m) { console.error(m); process.exit(1); }
function scan() { return scanAssetsDir(ASSETS_ROOT); }

export function list(type) {
  const reg = scan().registry;
  const ids = [...reg.keys()].filter((id) => !type || reg.get(id)?.declaration?.type === type).sort();
  console.log(type ? `assets of type "${type}" — ${ids.length}:` : `assets — ${ids.length} (types: ${listAssetTypes().join(', ')}):`);
  for (const id of ids) console.log(`  ${id.padEnd(28)} ${reg.get(id)?.declaration?.type ?? ''}`);
}

export function fields(type) {
  const schema = getAssetSchema(type);
  if (!schema) die(`Unknown asset type "${type}" (known: ${listAssetTypes().join(', ')})`);
  console.log(formatFields(schema, `${type} — asset schema`));
}

export function show(id) {
  const asset = scan().registry.get(id);
  if (!asset) die(`no asset "${id}"`);
  console.log(JSON.stringify(asset, null, 2));
}

export function refs(id) {
  const { aliases } = scan();
  const hits = Object.entries(aliases).filter(([, target]) => target === id).map(([name]) => name);
  if (!hits.length) return console.log(`"${id}" — aliased by nothing.`);
  console.log(`"${id}" — aliased by ${hits.length}:`);
  for (const h of hits) console.log(`  ${h}`);
}

export function validate() {
  const errs = validateAssetsDir(ASSETS_ROOT);
  if (!errs.length) return console.log('✓ assets valid');
  for (const e of errs) console.error(`  ${e.assetId ?? ''} ${e.message}`);
  die('');
}

// Exposed for parity/tests; the CLI does not scaffold art (bytes go through the art pipeline).
export { validateDeclaration };
