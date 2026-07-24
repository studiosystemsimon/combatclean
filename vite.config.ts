import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import marksmanEndpoint from './src/marksman/endpoint.mjs';
import { audioRoutes } from './src/marksman/features/audio/server.mjs';

// The data-driven engine wiring (@bishop/*):
//  - virtual:game-config    ← the merged, validated logical config + singletons + UI + visual registries.
//  - virtual:asset-registry ← the resolved asset database (ids → urls); formats from @bishop/asset-types-2d.
import { gameConfigPlugin } from '@bishop/config-registry/vite';
import { assetRegistryPlugin } from '@bishop/asset-registry/vite';
import { assertValidMerged, nextIds } from '@bishop/config-registry';
import { readLedger } from '@bishop/config-registry/node';
import { scanAssetsDir } from '@bishop/asset-registry/node';
import '@bishop/asset-types-2d'; // register asset extractors so the compose asset-ref integrity check can scan
import { CATEGORIES } from './src/data/config/manifest.ts';
import { zUIConfig } from './src/data/config/ui/ui-schema.ts';
import { zVisualConfig } from './src/view/combat/vsm/schema.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GAME_DIR = join(ROOT, 'src/data/config/game');
const UI_DIR = join(ROOT, 'src/data/config/ui');
const VISUAL_DIR = join(ROOT, 'src/data/visual-config');
const ASSETS_ROOT = join(ROOT, 'assets');

const readJson = (p: string): any => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : undefined);
const subdirs = (root: string): string[] =>
  existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

// Collect every asset-id referenced by a *AssetId / *AssetIds field, at any depth (UI iconAssetId/
// splashAssetId, VSM spriteAssetId, …), for the build-time asset-ref integrity check.
function collectAssetRefs(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectAssetRefs(n, out); return; }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (/AssetIds?$/.test(k)) { for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string' && id) out.add(id); }
    else collectAssetRefs(v, out);
  }
}

// compose — fold the game EXTRAS the config engine doesn't own into the baked bundle, and VALIDATE
// the whole thing (logical incl. singletons, UI, visual, cross-registry identity, asset refs) as the
// build gate. Runs at build + on every dev-server config edit.
function compose(merged: Record<string, unknown>, gameDir: string): Record<string, unknown> {
  // Singleton categories live in _<name>.json — the game-side storage convention (scanConfigDir skips
  // singletons; this compose is their ONLY reader). NOTE: the engine's writeMergedConfig/runMigrations
  // write singletons INTO _global.json — do NOT use those writers here, or a singleton edit would land
  // in _global.json and be silently ignored by this build. Keep singletons as _<name>.json.
  for (const c of CATEGORIES) {
    if (c.kind !== 'singleton') continue;
    const v = readJson(join(gameDir, `_${c.name}.json`));
    if (v !== undefined) merged[c.name] = v;
  }
  // Logical gate: schema + deep-strict + id/key uniqueness + lane + referential integrity (+ singletons).
  assertValidMerged(merged, CATEGORIES);

  // Logical id/key set per non-singleton category — for the cross-registry identity check.
  const idKeySet: Record<string, Set<string>> = {};
  for (const c of CATEGORIES) {
    if (c.kind === 'singleton') continue;
    const arr = Array.isArray(merged[c.name]) ? (merged[c.name] as Record<string, unknown>[]) : [];
    idKeySet[c.name] = new Set(arr.map((e) => String(c.kind === 'key' ? e[(c as { keyField: string }).keyField] : e.id)));
  }
  // Resolvable asset ids = pack ids + aliases (applyAliases adds alias keys to the registry map).
  const assetIds = new Set<string>(scanAssetsDir(ASSETS_ROOT).registry.keys());
  const assetRefs = new Set<string>();

  // UI registry: category → (id|key) → entry. Bake the PARSED result (r.data) so schema defaults
  // materialize; reject dup id/key + any id/key with no logical entry.
  const ui: Record<string, Record<string, unknown>> = {};
  for (const cat of subdirs(UI_DIR)) {
    ui[cat] = {};
    for (const f of readdirSync(join(UI_DIR, cat)).filter((n) => n.endsWith('.json'))) {
      const r = zUIConfig.safeParse(JSON.parse(readFileSync(join(UI_DIR, cat, f), 'utf-8')));
      if (!r.success) throw new Error(`[ui] ${cat}/${f}: ${r.error.issues.map((i) => i.message).join('; ')}`);
      const key = String(r.data.id ?? r.data.key);
      if (ui[cat][key] !== undefined) throw new Error(`[ui] ${cat}/${f}: duplicate id/key "${key}"`);
      if (idKeySet[cat] && !idKeySet[cat].has(key)) throw new Error(`[ui] ${cat}/${f}: id/key "${key}" has no logical entry in "${cat}"`);
      collectAssetRefs(r.data, assetRefs);
      ui[cat][key] = r.data;
    }
  }

  // Visual registry: id → VisualConfig. Same bake + integrity discipline.
  const visual: Record<string, unknown> = {};
  for (const cat of subdirs(VISUAL_DIR)) {
    for (const f of readdirSync(join(VISUAL_DIR, cat)).filter((n) => n.endsWith('.json'))) {
      const r = zVisualConfig.safeParse(JSON.parse(readFileSync(join(VISUAL_DIR, cat, f), 'utf-8')));
      if (!r.success) throw new Error(`[visual] ${cat}/${f}: ${r.error.issues.map((i) => i.message).join('; ')}`);
      const key = String(r.data.id);
      if (visual[key] !== undefined) throw new Error(`[visual] ${cat}/${f}: duplicate id "${key}"`);
      if (idKeySet[cat] && !idKeySet[cat].has(key)) throw new Error(`[visual] ${cat}/${f}: id "${key}" has no logical entry in "${cat}"`);
      collectAssetRefs(r.data, assetRefs);
      visual[key] = r.data;
    }
  }

  // Asset-ref integrity: every *AssetId / spriteAssetId in the UI + visual registries must resolve.
  const missing = [...assetRefs].filter((id) => !assetIds.has(id));
  if (missing.length) throw new Error(`[assets] unresolved *AssetId reference(s): ${missing.join(', ')}`);

  const global = readJson(join(gameDir, '_global.json')) ?? {};
  return {
    ...merged,
    ui,
    visual,
    refs: global.refs ?? {},
    schemaVersion: global.schemaVersion ?? 0,
    nextIds: nextIds(CATEGORIES, merged, readLedger(gameDir)),
  };
}

function marksmanAudioEnabled(): boolean {
  try {
    const cfg = JSON.parse(readFileSync(new URL('./marksman.config.json', import.meta.url), 'utf8'));
    return cfg?.features?.audio === true;
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => ({
  base: mode === 'capacitor' ? './' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // Logical config → virtual:game-config (merged + validated + composed).
    gameConfigPlugin({ gameDir: GAME_DIR, manifest: CATEGORIES, compose }),
    // Asset database → virtual:asset-registry (ids → urls).
    assetRegistryPlugin({
      assetsRoot: ASSETS_ROOT,
      registerFormats: async () => {
        await import('@bishop/asset-types-2d');
        await import('@bishop/asset-types-2d/schema');
      },
    }),
    marksmanEndpoint({ features: marksmanAudioEnabled() ? [audioRoutes] : [] }),
  ],
  server: {
    port: 5274,
    host: true, // expose on LAN for device live-reload
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
}));
