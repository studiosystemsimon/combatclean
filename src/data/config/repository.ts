// === Logical-config runtime repository ===
//
// Fronts the build-baked, Zod-validated logical config (`virtual:game-config`,
// statically imported once — Capacitor-safe, no runtime fetch) with id/key → entry
// maps. Runtime code resolves content by numeric id (id-kind) or string key (key-kind).
// The category KIND is inferred from the data (an entry has a numeric `id` or a string
// `key`) so this module never imports the manifest — and therefore zod never enters the
// browser bundle. Presentation (name/colour/icon) is backfilled from the UI registry.
import bundle from 'virtual:game-config';
import { getUIConfigIn } from './ui-config-repository.ts';

export type ConfigEntry = Record<string, unknown>;

// Category arrays only (skip singleton objects + the refs/ui/nextIds meta keys).
const CATEGORY_ARRAYS: Record<string, ConfigEntry[]> = {};
for (const [name, value] of Object.entries(bundle)) {
  if (Array.isArray(value)) CATEGORY_ARRAYS[name] = value as ConfigEntry[];
}

// Global id → entry (id-kind ids are globally unique) + per-category id|key → entry.
const byId = new Map<number, ConfigEntry>();
const byCategory: Record<string, Map<string, ConfigEntry>> = {};
for (const [category, arr] of Object.entries(CATEGORY_ARRAYS)) {
  const map = new Map<string, ConfigEntry>();
  for (const entry of arr) {
    const id = entry.id;
    const key = entry.key;
    if (typeof id === 'number') {
      byId.set(id, entry);
      map.set(String(id), entry);
    }
    if (typeof key === 'string') map.set(key, entry);
  }
  byCategory[category] = map;
}

/** All entries in a category (empty array if unknown). */
export function byType(category: string): ConfigEntry[] {
  return CATEGORY_ARRAYS[category] ?? [];
}

/** An id-kind entry by its globally-unique numeric id. */
export function getById(id: number): ConfigEntry | undefined {
  return byId.get(id);
}

/** An entry in a category by numeric id (id-kind) or string key (key-kind). */
export function getIn(category: string, idOrKey: number | string): ConfigEntry | undefined {
  return byCategory[category]?.get(String(idOrKey));
}

/** A well-known content id code pins (from _global.json#refs) — throws if absent, never a hardcoded number. */
export function getRef(name: string): number {
  const id = bundle.refs?.[name];
  if (typeof id !== 'number') throw new Error(`[config] no well-known ref "${name}" in _global.json#refs`);
  return id;
}

/** An entry merged with its UI presentation (name/colour/icon) — for legacy readers that expect e.name. */
export function present(category: string, idOrKey: number | string): ConfigEntry {
  return { ...getIn(category, idOrKey), ...getUIConfigIn(category, idOrKey) };
}

// Singleton game-global tuning objects (validated by the same engine as the categories).
export const battle = bundle.battle;
export const energy = bundle.energy;
export const progression = bundle.progression;

/** The config schema version + derived next-id-per-category seed (for editors). */
export const schemaVersion: number = bundle.schemaVersion;
export const nextIds: Record<string, number> = bundle.nextIds ?? {};

/** A diagnostic summary of the baked config — the data-source marker the boot screen renders. */
export function summary(): { schemaVersion: number; categories: string[]; entries: number } {
  const categories = Object.keys(CATEGORY_ARRAYS).sort();
  const entries = categories.reduce((n, c) => n + CATEGORY_ARRAYS[c].length, 0);
  return { schemaVersion, categories, entries };
}
