// Node-only surface: disk scan/write + the never-reuse id ledger + createEntity. The browser-safe
// mechanics (validate, refs, allocate, inspect) are the package root; this adds `node:fs` on top.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type IdLedger, nextId } from "./allocate.js";
import { assertValidMerged } from "./validate.js";
import { buildInspectContext, type InspectContext } from "./inspect.js";
import {
	byName,
	type ConfigCategory,
	isIdCategory,
	isKeyCategory,
	isSingletonCategory,
	type Manifest,
} from "./manifest.js";
import { buildRefIndex, type RefIndex } from "./refs.js";

export function slugify(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

/** The stable per-entity filename (decorative — merge keys off the in-file id/keyField). */
function entryFilename(cat: ConfigCategory, entry: Record<string, unknown>): string {
	if (isKeyCategory(cat)) return slugify(String(entry[cat.keyField] ?? ""));
	return `${entry.id}-${slugify(String(entry.displayName ?? ""))}`;
}

function readFolderEntities(dir: string): Record<string, unknown>[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

/**
 * Read every per-entity JSON file into a merged config (one array per category), keyed off the in-file
 * `id` (id-kind) / `keyField` (key-kind). Fails fast on a missing/duplicate identity — the merge would
 * otherwise silently drop/overwrite an entity. Generic: only the manifest's categories; game-specific
 * singletons (`_global.json`, string-id catalogs) are the wrapper's job.
 */
export function scanConfigDir(gameDir: string, manifest: Manifest): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	for (const cat of manifest) {
		if (isSingletonCategory(cat)) continue; // singletons live in _global.json — the wrapper composes them
		const dir = join(gameDir, cat.folder);
		const entries: Record<string, unknown>[] = [];
		if (existsSync(dir)) {
			const seen = new Map<string, string>();
			for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
				const entry = JSON.parse(readFileSync(join(dir, file), "utf-8"));
				const identity = isIdCategory(cat) ? entry.id : entry[cat.keyField];
				const kind = isIdCategory(cat) ? "id" : cat.keyField;
				if (identity == null || (isIdCategory(cat) && typeof identity !== "number")) {
					throw new Error(`[config] ${join(cat.folder, file)}: missing or invalid "${kind}"`);
				}
				const prev = seen.get(String(identity));
				if (prev !== undefined) {
					throw new Error(`[config] duplicate ${kind} ${identity} in ${cat.folder}: "${file}" vs "${prev}"`);
				}
				seen.set(String(identity), file);
				entries.push(entry);
			}
		}
		if (isIdCategory(cat)) entries.sort((a, b) => (a.id as number) - (b.id as number));
		merged[cat.name] = entries;
	}
	return merged;
}

/** Write a folder of per-entity JSON files (tab-indented, trailing newline), deleting orphans. */
export function writeEntityFolder(dir: string, cat: ConfigCategory, entries: Record<string, unknown>[]): void {
	mkdirSync(dir, { recursive: true });
	const newNames = new Set(entries.map((e) => entryFilename(cat, e)));
	const existing = existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f.endsWith(".json"))
				.map((f) => f.replace(".json", ""))
		: [];
	for (const oldName of existing) {
		if (!newNames.has(oldName)) unlinkSync(join(dir, `${oldName}.json`));
	}
	for (const entry of entries) {
		writeFileSync(join(dir, `${entryFilename(cat, entry)}.json`), `${JSON.stringify(entry, null, "\t")}\n`, "utf-8");
	}
}

const identityOf = (cat: ConfigCategory, e: Record<string, unknown>) =>
	isKeyCategory(cat) ? e[cat.keyField] : e.id;

/** Upsert ONE entity into its folder without touching siblings, bumping the id ledger for id-kind. */
export function writeEntity(gameDir: string, manifest: Manifest, categoryName: string, entity: Record<string, unknown>): string {
	const cat = byName(manifest).get(categoryName);
	if (!cat) throw new Error(`[config] unknown category "${categoryName}"`);
	if (isSingletonCategory(cat)) throw new Error(`[config] "${categoryName}" is a singleton — write it via _global.json, not writeEntity`);
	const dir = join(gameDir, cat.folder);
	const entries = readFolderEntities(dir).filter((e) => identityOf(cat, e) !== identityOf(cat, entity));
	entries.push(entity);
	writeEntityFolder(dir, cat, entries);
	if (isIdCategory(cat) && typeof entity.id === "number") bumpLedger(gameDir, categoryName, entity.id);
	return cat.folder;
}

// Engine-computed keys the merge derives at read time — never written back to disk.
const COMPUTED_KEYS = new Set(["nextIds", "nextId"]);

/**
 * Decompose a whole merged config into per-entity folders + `_global.json` (the inverse of
 * `scanConfigDir` plus the wrapper's singleton compose). Manifest arrays go to their category folder
 * (orphans deleted); everything else lands in `_global.json`, minus engine-computed keys and any
 * game-specific `skipKeys` the caller passes (e.g. non-enumerable derived blocks). Node-only (fs).
 */
export function writeMergedConfig(
	gameDir: string,
	manifest: Manifest,
	config: Record<string, unknown>,
	{ skipKeys = [] }: { skipKeys?: string[] } = {},
): void {
	const cats = byName(manifest);
	const skip = new Set([...COMPUTED_KEYS, ...skipKeys]);
	const global: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		const cat = cats.get(key);
		if (cat && !isSingletonCategory(cat) && Array.isArray(value)) {
			writeEntityFolder(join(gameDir, cat.folder), cat, value as Record<string, unknown>[]);
		} else if (!skip.has(key)) {
			global[key] = value;
		}
	}
	writeFileSync(join(gameDir, "_global.json"), `${JSON.stringify(global, null, "\t")}\n`, "utf-8");
}

// ── ID ledger (never-reuse high-water marks) ──
const LEDGER_FILE = "_id-ledger.json";

export function readLedger(gameDir: string): IdLedger {
	const p = join(gameDir, LEDGER_FILE);
	if (!existsSync(p)) return {};
	try {
		return JSON.parse(readFileSync(p, "utf-8"));
	} catch {
		return {};
	}
}

export function writeLedger(gameDir: string, ledger: IdLedger): void {
	const sorted: IdLedger = {};
	for (const k of Object.keys(ledger).sort()) sorted[k] = ledger[k];
	writeFileSync(join(gameDir, LEDGER_FILE), `${JSON.stringify(sorted, null, "\t")}\n`, "utf-8");
}

export function bumpLedger(gameDir: string, categoryName: string, id: number): void {
	const ledger = readLedger(gameDir);
	if ((ledger[categoryName] ?? -Infinity) < id) {
		ledger[categoryName] = id;
		writeLedger(gameDir, ledger);
	}
}

/**
 * Build a new entity (id allocated from lane + ledger for id-kind; caller supplies the key for key-kind)
 * merged with `overrides`, WITHOUT writing. Returns the entity + the merged config it was allocated
 * against so the caller can validate-before-write. Does not mutate disk.
 */
export function createEntity(
	gameDir: string,
	manifest: Manifest,
	categoryName: string,
	overrides: Record<string, unknown> = {},
): { entity: Record<string, unknown>; merged: Record<string, unknown> } {
	const cat = byName(manifest).get(categoryName);
	if (!cat) throw new Error(`[config] unknown category "${categoryName}"`);
	const merged = scanConfigDir(gameDir, manifest);
	if (isIdCategory(cat)) {
		const ids = (merged[cat.name] as { id?: unknown }[]).map((e) => e.id).filter((i): i is number => typeof i === "number");
		const id = nextId(cat, ids, readLedger(gameDir)[cat.name]);
		return { entity: { id, displayName: overrides.displayName ?? `New ${cat.name}`, ...overrides }, merged };
	}
	if (!isKeyCategory(cat)) {
		throw new Error(`[config] cannot createEntity for a singleton category "${cat.name}"`);
	}
	if (!overrides[cat.keyField]) {
		throw new Error(`[config] key-kind category "${cat.name}" needs a "${cat.keyField}" value in overrides`);
	}
	return { entity: { displayName: overrides.displayName ?? String(overrides[cat.keyField]), ...overrides }, merged };
}

const GLOBAL_FILE = "_global.json";

/** A schemaVersion-gated migration: transform one entity, or the whole merged config, or both. */
export interface Migration {
	up?(entity: Record<string, unknown>, category: string): Record<string, unknown> | void;
	upAll?(merged: Record<string, unknown>): Record<string, unknown> | void;
}

/**
 * Run schemaVersion-gated migrations over `config/game/**`. Applies every `migrationsDir/NNN-*.mjs`
 * whose NNN > the current `schemaVersion` (in `_global.json`), in ascending order, over the disk source
 * (per-entity folders + `_global.json` singletons). Validates the result against the manifest, writes
 * back only the CHANGED per-entity files + a refreshed `_global.json` (with the bumped schemaVersion),
 * and returns what moved. Idempotent (version gate). Node-only; `dryRun` computes without writing.
 */
export async function runMigrations(
	gameDir: string,
	manifest: Manifest,
	migrationsDir: string,
	{ dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ from: number; to: number; changed: number }> {
	const globalPath = join(gameDir, GLOBAL_FILE);
	const globalBlock: Record<string, unknown> = existsSync(globalPath)
		? JSON.parse(readFileSync(globalPath, "utf-8"))
		: {};
	const current = typeof globalBlock.schemaVersion === "number" ? globalBlock.schemaVersion : 0;

	const pending = (existsSync(migrationsDir) ? readdirSync(migrationsDir) : [])
		.filter((f) => f.endsWith(".mjs"))
		.map((f) => ({ f, n: Number(f.split("-")[0]) }))
		.filter((m) => Number.isFinite(m.n) && m.n > current)
		.sort((a, b) => a.n - b.n);

	if (!pending.length) return { from: current, to: current, changed: 0 };

	const before = scanConfigDir(gameDir, manifest);
	// Migrations see disk source: category arrays + `_global.json` singletons (no derived blocks).
	const merged: Record<string, unknown> = structuredClone({ ...globalBlock, ...before });
	let version = current;

	for (const { f, n } of pending) {
		const mod: Migration = await import(pathToFileURL(join(migrationsDir, f)).href);
		if (typeof mod.upAll === "function") Object.assign(merged, mod.upAll(merged) ?? merged);
		if (typeof mod.up === "function") {
			for (const cat of manifest) {
				if (isSingletonCategory(cat)) continue;
				const arr = merged[cat.name];
				if (Array.isArray(arr)) merged[cat.name] = arr.map((e) => mod.up?.(e, cat.name) ?? e);
			}
		}
		version = n;
	}

	assertValidMerged(merged, manifest);

	let changed = 0;
	for (const cat of manifest) {
		if (isSingletonCategory(cat)) continue;
		const now = Array.isArray(merged[cat.name]) ? (merged[cat.name] as Record<string, unknown>[]) : [];
		const wasByKey = new Map(
			(Array.isArray(before[cat.name]) ? (before[cat.name] as Record<string, unknown>[]) : []).map(
				(e) => [String(identityOf(cat, e)), JSON.stringify(e)],
			),
		);
		for (const e of now) {
			if (wasByKey.get(String(identityOf(cat, e))) !== JSON.stringify(e)) {
				changed++;
				if (!dryRun) writeEntity(gameDir, manifest, cat.name, e);
			}
		}
	}

	if (!dryRun) {
		// Refresh `_global.json` only (category files were written change-by-change above, keeping diffs
		// minimal): singleton/global keys + the bumped schemaVersion, minus category arrays + computed keys.
		const cats = byName(manifest);
		const global: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(merged)) {
			const cat = cats.get(key);
			if (cat && !isSingletonCategory(cat) && Array.isArray(value)) continue;
			if (!COMPUTED_KEYS.has(key)) global[key] = value;
		}
		global.schemaVersion = version;
		writeFileSync(globalPath, `${JSON.stringify(global, null, "\t")}\n`, "utf-8");
	}
	return { from: current, to: version, changed };
}

/** One-read bundle: merged config + ref index + inspection context. */
export function loadContext(gameDir: string, manifest: Manifest): {
	merged: Record<string, unknown>;
	index: RefIndex;
	ctx: InspectContext;
} {
	const merged = scanConfigDir(gameDir, manifest);
	const index = buildRefIndex(manifest);
	const ctx = buildInspectContext(merged, manifest, index);
	return { merged, index, ctx };
}
