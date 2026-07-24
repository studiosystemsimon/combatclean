// ─────────────────────────────────────────────────────────────────────────────
// Build-time asset-processing system (BUILD-ONLY — carries zod, shells out).
//
// A processor transforms an asset's FORMAT or SHAPE at build time. It runs as an
// ordered FLOW (map/fold pipeline) over a selected asset GROUP, per build profile.
// The registry is the remap layer: a processor patches `files`/`derived`/`declaration`
// on the resolved entries; the `assetId` never changes.
//
//   • MAP  processor — 1 unit in, 1 unit out (WAV→MP3, PNG→WebP, resize).
//   • FOLD processor — N units in, 1 shared artifact out (frames → one packed sheet);
//     each source id is REDIRECTED to the shared sheet, carrying its own `derived`.
//
// The core knows the SHAPE of a processor and how to run + cache + option-validate the
// flow. It knows nothing about png/webp/ffmpeg — a game registers its own processors.
// This file is NEVER imported by the browser `.` entry (it uses zod values + node:fs).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { z } from "zod";
import type { AssetDeclaration, AssetRegistry, ResolvedAsset } from "./types.js";

// ─── Processor contract ───

export type NamedBytes = { relPath: string; bytes: Uint8Array };

/** What inputs a processor can handle — self-filter. A selected-but-unhandled asset is warn+skip. */
export type AssetInputSpec =
	| { extensions?: string[]; types?: string[] }
	| ((asset: ResolvedAsset) => boolean);

export interface BaseProcessor<O> {
	id: string;
	/** Bump to bust the cache on an algorithm change. */
	version?: number;
	/** REQUIRED — validates this processor's options and (with the parsed value) seeds the cache key. */
	optionsSchema: z.ZodType<O>;
	/** REQUIRED — declared supported inputs. */
	accepts: AssetInputSpec;
	/** Optional external-tool version (e.g. ffmpeg) folded into the cache key so an upgrade re-processes. */
	toolVersion?(): string | undefined;
}

export interface MapContext<O> {
	/** The source assets this unit represents (read-only: declaration + derived + id). Usually one. */
	assets: readonly ResolvedAsset[];
	artifacts: NamedBytes[];
	options: O;
	/** Persist a cross-referenced output under a chosen name; returns its `files[]`-usable relPath.
	 *  Optional — a processor may instead just return `artifacts` with raw bytes and the runner persists them. */
	emit(relPath: string, bytes: Uint8Array): string;
}
export interface MapResult {
	artifacts: NamedBytes[];
	derived?: Record<string, unknown>;
	declaration?: AssetDeclaration;
}
export interface MapProcessor<O = unknown> extends BaseProcessor<O> {
	kind: "map";
	process(ctx: MapContext<O>): Promise<MapResult | null>;
}

export interface FoldContext<O> {
	members: { assetId: string; asset: ResolvedAsset; artifacts: NamedBytes[] }[];
	options: O;
	emit(relPath: string, bytes: Uint8Array): string;
}
export interface FoldResult {
	/** The shared artifact(s), e.g. the packed sheet. */
	artifacts: NamedBytes[];
	/** Optional standalone "load the whole atlas" registry entry. Members get `aliasOf = sheetAsset.id`. */
	sheetAsset?: { id: string; declaration: AssetDeclaration; derived?: Record<string, unknown> };
	/** Each input id → its metadata (e.g. its rect) into the shared artifact. */
	bindings: {
		assetId: string;
		derived?: Record<string, unknown>;
		declaration?: AssetDeclaration;
	}[];
}
export interface FoldProcessor<O = unknown> extends BaseProcessor<O> {
	kind: "fold";
	process(ctx: FoldContext<O>): Promise<FoldResult>;
}

export type AssetProcessor<O = unknown> = MapProcessor<O> | FoldProcessor<O>;

// ─── Registration (mirrors registerAssetSchema / registerAssetFileExtractor) ───

const processors = new Map<string, AssetProcessor>();

export function registerAssetProcessor<O>(p: AssetProcessor<O>): void {
	// O is contravariant in process(); the store keeps them opaque and the runner re-parses options.
	processors.set(p.id, p as unknown as AssetProcessor);
}
export function getAssetProcessor(id: string): AssetProcessor | undefined {
	return processors.get(id);
}
export function getAssetProcessors(): AssetProcessor[] {
	return [...processors.values()];
}
/** Test/introspection helper — drop all registered processors. */
export function clearAssetProcessors(): void {
	processors.clear();
}

// ─── Selector ───

const zMatcher = z.union([z.object({ glob: z.string() }), z.object({ regex: z.string() })]);
export type Matcher = z.infer<typeof zMatcher>;

export const zAssetSelector = z
	.object({
		/** Matched against ResolvedAsset.files[] (incl. extension). */
		path: z.array(zMatcher).optional(),
		/** Matched against assetId. */
		id: z.array(zMatcher).optional(),
	})
	.refine((s) => (s.path?.length ?? 0) > 0 || (s.id?.length ?? 0) > 0, "selector needs path or id");
export type AssetSelector = z.infer<typeof zAssetSelector>;

export const zPipelineStep = z.object({
	use: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
});
export const zPipeline = z.object({ match: zAssetSelector, steps: z.array(zPipelineStep).min(1) });
export const zProcessingConfig = z.record(z.string(), z.array(zPipeline)); // profile → pipelines
export type Pipeline = z.infer<typeof zPipeline>;
export type ProcessingConfig = z.infer<typeof zProcessingConfig>;

/**
 * Minimal glob → RegExp. Supports `**`, `*`, `?`, `{a,b}` and treats `.`/`/` literally.
 * ponytail: covers our path/id patterns; swap in `picomatch` if patterns outgrow it.
 */
export function globToRegExp(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				i++;
				if (glob[i + 1] === "/") {
					i++;
					re += "(?:.*/)?"; // `**/` → any number of dirs, optional
				} else re += ".*"; // `**` → anything
			} else re += "[^/]*"; // `*` → anything but a slash
		} else if (c === "?") re += "[^/]";
		else if (c === "{") {
			const end = glob.indexOf("}", i);
			if (end === -1) re += "\\{";
			else {
				const alts = glob.slice(i + 1, end).split(",");
				re += `(?:${alts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
				i = end;
			}
		} else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${re}$`);
}

function matcherTest(m: Matcher, value: string): boolean {
	return "glob" in m ? globToRegExp(m.glob).test(value) : new RegExp(m.regex).test(value);
}

/** Does an asset satisfy the selector? Both dimensions combinable (AND); within a dimension, any-of. */
export function matchSelector(asset: ResolvedAsset, sel: AssetSelector): boolean {
	if (sel.path?.length) {
		if (!sel.path.some((m) => asset.files.some((f) => matcherTest(m, f)))) return false;
	}
	if (sel.id?.length) {
		if (!sel.id.some((m) => matcherTest(m, asset.id))) return false;
	}
	return true;
}

// ─── Runner ───

/** Bump when the cached RegistryOp shape or the key composition changes — invalidates every entry. */
const CACHE_VERSION = 1;

interface WorkUnit {
	assetIds: string[];
	type: string;
	artifacts: NamedBytes[];
	perAsset: Map<string, { derived?: Record<string, unknown>; declaration?: AssetDeclaration }>;
	/** Set by a fold: the standalone shared-sheet asset to add as its own registry entry. */
	sheetAsset?: FoldResult["sheetAsset"];
}

type RegistryOp =
	| {
			op: "patch";
			id: string;
			files: string[];
			derived?: Record<string, unknown>;
			declaration?: AssetDeclaration;
	  }
	| {
			op: "add";
			id: string;
			type: string;
			declaration: AssetDeclaration;
			files: string[];
			derived?: Record<string, unknown>;
	  };

/** Injectable disk boundary — real fs by default, in-memory in tests. */
export interface ProcessingHost {
	readSource(relPath: string): Uint8Array;
	/** True if a source file exists — lets the runner skip assets whose declared file is missing
	 *  (stale manifest entry) with a warning instead of hard-crashing the build. Optional so older
	 *  hosts (tests) still satisfy the interface; the runner treats absence as "assume present". */
	exists?(relPath: string): boolean;
	/** Persist a processed artifact; returns a `files[]`-usable relPath (`@proc/…`) the plugin resolves. */
	persistBlob(bytes: Uint8Array, ext: string): string;
	getUnitCache(key: string): RegistryOp[] | undefined;
	setUnitCache(key: string, ops: RegistryOp[]): void;
}

/** Emitted files live under this prefix; the vite plugin resolves them against the cache dir, not the root. */
export const PROCESSED_PREFIX = "@proc/";

export interface ProcessRegistryOptions {
	root: string;
	profile: string;
	config: ProcessingConfig;
	cacheDir?: string;
	/** Max parallel map units. Default = available CPU parallelism. */
	concurrency?: number;
	host?: ProcessingHost;
	warn?: (msg: string) => void;
}

const sha1 = (bufs: (Uint8Array | string)[]): string => {
	const h = createHash("sha1");
	for (const b of bufs) h.update(b);
	return h.digest("hex");
};

/** key-sorted stringify so option/declaration key-order never busts the cache. */
function canonicalJSON(v: unknown): string {
	if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
	if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(",")}]`;
	const keys = Object.keys(v as object).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** Bounded-concurrency map. ponytail: ~10 lines beats a `p-limit` dep. */
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	const res = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const i = next++;
			res[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, worker));
	return res;
}

/** Run one processor step, wrapping any throw with which processor + assets failed (actionable build error). */
async function runStep<R>(procId: string, assetIds: string[], fn: () => Promise<R>): Promise<R> {
	try {
		return await fn();
	} catch (e) {
		throw new Error(
			`[asset-processing] processor "${procId}" failed on ${assetIds.join(", ")}: ${(e as Error).message}`,
		);
	}
}

function fsHost(root: string, cacheDir: string): ProcessingHost {
	const blobDir = join(cacheDir, "blobs");
	const unitDir = join(cacheDir, "units");
	// Atomic write — tmp then rename — so a crash mid-write never leaves a half file a later run reads.
	const writeAtomic = (abs: string, bytes: Uint8Array | string): void => {
		mkdirSync(dirname(abs), { recursive: true });
		const tmp = `${abs}.${randomBytes(6).toString("hex")}.tmp`;
		writeFileSync(tmp, bytes);
		renameSync(tmp, abs);
	};
	return {
		readSource: (rel) => readFileSync(resolve(root, rel)),
		exists: (rel) => existsSync(resolve(root, rel)),
		persistBlob(bytes, ext) {
			const name = sha1([bytes]) + ext;
			const abs = join(blobDir, name);
			if (!existsSync(abs)) writeAtomic(abs, bytes);
			return PROCESSED_PREFIX + name;
		},
		getUnitCache(key) {
			const abs = join(unitDir, `${key}.json`);
			if (!existsSync(abs)) return undefined;
			try {
				return JSON.parse(readFileSync(abs, "utf-8")) as RegistryOp[];
			} catch {
				return undefined; // corrupt entry → treat as a miss, reprocess
			}
		},
		setUnitCache(key, ops) {
			writeAtomic(join(unitDir, `${key}.json`), JSON.stringify(ops));
		},
	};
}

function acceptsAsset(spec: AssetInputSpec, unit: WorkUnit, original: ResolvedAsset): boolean {
	if (typeof spec === "function") return spec(original);
	// If neither key is declared, accept everything; else pass if any declared condition matches.
	if (!spec.extensions && !spec.types) return true;
	const extOk =
		spec.extensions?.some((e) =>
			unit.artifacts.some((a) => extname(a.relPath).slice(1).toLowerCase() === e.toLowerCase()),
		) ?? false;
	const typeOk = spec.types?.includes(unit.type) ?? false;
	return extOk || typeOk;
}

/** A resolved step: the processor + its VALIDATED (defaulted) options + a stable signature. */
interface PlannedStep {
	proc: AssetProcessor;
	options: unknown;
	sig: string;
}

function planSteps(pipeline: Pipeline, profile: string, pIdx: number): PlannedStep[] {
	return pipeline.steps.map((step, sIdx) => {
		const proc = processors.get(step.use);
		if (!proc) {
			throw new Error(
				`[asset-processing] profile "${profile}" pipeline ${pIdx} step ${sIdx}: unknown processor "${step.use}"`,
			);
		}
		let options: unknown;
		try {
			options = proc.optionsSchema.parse(step.options ?? {});
		} catch (e) {
			throw new Error(
				`[asset-processing] profile "${profile}" pipeline ${pIdx} step ${sIdx} (${step.use}): bad options — ${(e as Error).message}`,
			);
		}
		const sig = canonicalJSON([proc.id, proc.version ?? 0, proc.toolVersion?.() ?? "", options]);
		return { proc, options, sig };
	});
}

/**
 * Content-addressed cache key for a final WorkUnit. Includes, per asset: its id, its DECLARATION +
 * DERIVED (a processor may read these), and every source file's bytes — plus the step chain + a
 * cache-format version. Editing any input (bytes, declaration, options, tool, algorithm) busts it.
 */
function unitKey(
	assets: readonly ResolvedAsset[],
	read: (relPath: string) => Uint8Array,
	sig: string,
): string {
	const parts: (Uint8Array | string)[] = [`v${CACHE_VERSION}`, "\0", sig, "\0"];
	for (const a of [...assets].sort((x, y) => x.id.localeCompare(y.id))) {
		parts.push(a.id, canonicalJSON(a.declaration), canonicalJSON(a.derived ?? null), "\0");
		for (const rel of [...a.files].sort()) parts.push(rel, read(rel));
	}
	return sha1(parts);
}

function applyOps(registry: AssetRegistry, ops: RegistryOp[]): void {
	for (const op of ops) {
		if (op.op === "add") {
			registry.set(op.id, {
				id: op.id,
				type: op.type,
				declaration: op.declaration,
				basePath: "",
				manifestPath: PROCESSED_PREFIX,
				files: op.files,
				...(op.derived ? { derived: op.derived } : {}),
			});
			continue;
		}
		const entry = registry.get(op.id);
		if (!entry) continue;
		entry.files = op.files;
		if (op.declaration) {
			entry.declaration = op.declaration;
			entry.type = op.declaration.type;
		}
		if (op.derived) entry.derived = { ...entry.derived, ...op.derived };
	}
}

interface ChainCtx {
	concurrency: number;
	emit: (relPath: string, bytes: Uint8Array) => string;
	/** Persist any artifact a processor returned by value (didn't `emit`), so `files[]` never dangles. */
	persist: (arts: NamedBytes[]) => NamedBytes[];
	original: Map<string, ResolvedAsset>;
	warn: (msg: string) => void;
	pIdx: number;
}

/**
 * Run a pipeline's ordered flow over its WorkUnits: map steps fan out (bounded), fold steps collapse
 * every unit into one shared-artifact unit. Returns the final units to commit.
 */
async function runChain(
	steps: PlannedStep[],
	units: WorkUnit[],
	ctx: ChainCtx,
): Promise<WorkUnit[]> {
	const { concurrency, emit, persist, original, warn, pIdx } = ctx;
	const assetsOf = (u: WorkUnit): ResolvedAsset[] =>
		u.assetIds.map((id) => original.get(id)).filter((a): a is ResolvedAsset => a !== undefined);
	let current = units;

	for (const step of steps) {
		if (step.proc.kind === "map") {
			const proc = step.proc;
			current = await mapPool(current, concurrency, async (u) => {
				const assets = assetsOf(u);
				if (!acceptsAsset(proc.accepts, u, assets[0])) {
					warn(
						`[asset-processing] ${proc.id} skipped "${u.assetIds.join(",")}" (accepts mismatch)`,
					);
					return u;
				}
				const r = await runStep(proc.id, u.assetIds, () =>
					proc.process({ assets, artifacts: u.artifacts, options: step.options, emit }),
				);
				if (!r) return u;
				for (const id of u.assetIds) {
					const pa = u.perAsset.get(id) ?? {};
					if (r.derived) pa.derived = { ...pa.derived, ...r.derived };
					if (r.declaration) pa.declaration = r.declaration;
					u.perAsset.set(id, pa);
				}
				return { ...u, artifacts: persist(r.artifacts), type: r.declaration?.type ?? u.type };
			});
		} else {
			const proc = step.proc;
			const members: FoldContext<unknown>["members"] = [];
			for (const u of current) {
				if (acceptsAsset(proc.accepts, u, assetsOf(u)[0])) {
					for (const asset of assetsOf(u)) {
						members.push({ assetId: asset.id, asset, artifacts: u.artifacts });
					}
				} else {
					warn(
						`[asset-processing] ${proc.id} excluded "${u.assetIds.join(",")}" from fold (accepts mismatch)`,
					);
				}
			}
			if (members.length === 0) {
				warn(`[asset-processing] fold ${proc.id} in pipeline ${pIdx} had no handleable members`);
				continue;
			}
			const r = await runStep(
				proc.id,
				members.map((m) => m.assetId),
				() => proc.process({ members, options: step.options, emit }),
			);
			const perAsset = new Map<
				string,
				{ derived?: Record<string, unknown>; declaration?: AssetDeclaration }
			>();
			for (const b of r.bindings) {
				perAsset.set(b.assetId, { derived: b.derived, declaration: b.declaration });
			}
			current = [
				{
					assetIds: r.bindings.map((b) => b.assetId),
					type:
						r.sheetAsset?.declaration.type ??
						r.bindings[0]?.declaration?.type ??
						current[0]?.type ??
						"",
					artifacts: persist(r.artifacts),
					perAsset,
					sheetAsset: r.sheetAsset,
				},
			];
		}
	}
	return current;
}

/** Turn final WorkUnits into registry ops: add the shared sheet (if any) + patch every member id. */
function commit(units: WorkUnit[]): RegistryOp[] {
	const ops: RegistryOp[] = [];
	for (const u of units) {
		const files = u.artifacts.map((a) => a.relPath);
		if (u.sheetAsset) {
			ops.push({
				op: "add",
				id: u.sheetAsset.id,
				type: u.sheetAsset.declaration.type,
				declaration: u.sheetAsset.declaration,
				files,
				...(u.sheetAsset.derived ? { derived: u.sheetAsset.derived } : {}),
			});
		}
		for (const id of u.assetIds) {
			const pa = u.perAsset.get(id) ?? {};
			ops.push({
				op: "patch",
				id,
				files,
				...(pa.derived ? { derived: pa.derived } : {}),
				...(pa.declaration ? { declaration: pa.declaration } : {}),
			});
		}
	}
	return ops;
}

/**
 * Transform the registry in place per the active profile's pipelines. Reads source bytes, runs each
 * pipeline's flow (map = parallel fan-out, fold = barrier), caches per final WorkUnit, and patches
 * the resolved entries. No-op when the profile has no pipelines (so "processing off" is pure config).
 */
export async function processRegistry(
	registry: AssetRegistry,
	opts: ProcessRegistryOptions,
): Promise<void> {
	if (!opts.config[opts.profile]?.length) return;

	// Validation layer 1 — structural. A malformed selector / step shape fails here, before any bytes.
	let config: ProcessingConfig;
	try {
		config = zProcessingConfig.parse(opts.config);
	} catch (e) {
		throw new Error(`[asset-processing] invalid processing config: ${(e as Error).message}`);
	}
	const pipelines = config[opts.profile];

	const cacheDir = opts.cacheDir ?? join(opts.root, "node_modules/.cache/asset-processing");
	const host = opts.host ?? fsHost(opts.root, cacheDir);
	const warn = opts.warn ?? ((m: string) => console.warn(m));
	const concurrency = opts.concurrency ?? availableParallelism();

	// Read each source file at most once — reused by both the cache key and the initial artifacts.
	const bytesCache = new Map<string, Uint8Array>();
	const read = (rel: string): Uint8Array => {
		let b = bytesCache.get(rel);
		if (!b) {
			b = host.readSource(rel);
			bytesCache.set(rel, b);
		}
		return b;
	};
	const freshUnit = (a: ResolvedAsset): WorkUnit => ({
		assetIds: [a.id],
		type: a.type,
		artifacts: a.files.map((rel) => ({ relPath: rel, bytes: read(rel) })),
		perAsset: new Map([[a.id, {}]]),
	});

	const assets = [...registry.values()]
		.filter((a) => !a.aliasOf) // aliases follow their target
		// Skip assets whose declared source file is missing on disk (stale manifest entry) with a
		// warning, instead of hard-crashing the build in freshUnit's eager read. Such an asset keeps
		// its original (unprocessed) `files`; downstream (e.g. the vite plugin's ?url loop) skips it.
		.filter((a) => {
			if (!host.exists) return true; // host can't check → assume present (tests / in-memory)
			const missing = a.files.find((rel) => !rel.startsWith(PROCESSED_PREFIX) && !host.exists?.(rel));
			if (missing) {
				warn(`[asset-processing] skip "${a.id}" — missing source file "${missing}" (stale manifest entry)`);
				return false;
			}
			return true;
		});

	// Plan pass — resolve steps + match groups against the PRISTINE registry (before any step mutates
	// `files`), and enforce single-pipeline-per-asset. Only then do we process.
	const claimed = new Map<string, number>(); // assetId → pipeline index (ambiguity guard)
	const plans = pipelines.map((pipeline, pIdx) => {
		const steps = planSteps(pipeline, opts.profile, pIdx);
		const group = assets.filter((a) => matchSelector(a, pipeline.match));
		for (const a of group) {
			const prev = claimed.get(a.id);
			if (prev !== undefined) {
				throw new Error(
					`[asset-processing] asset "${a.id}" is selected by pipelines ${prev} and ${pIdx} in profile "${opts.profile}" (ambiguous grouping)`,
				);
			}
			claimed.set(a.id, pIdx);
		}
		return { steps, group, pIdx };
	});

	for (const { steps, group, pIdx } of plans) {
		if (group.length === 0) continue;

		const chainSig = canonicalJSON(steps.map((s) => s.sig));
		const hasFold = steps.some((s) => s.proc.kind === "fold");
		const original = new Map(group.map((a) => [a.id, a]));
		const emit = (relPath: string, bytes: Uint8Array): string =>
			host.persistBlob(bytes, extname(relPath));
		const persist = (arts: NamedBytes[]): NamedBytes[] =>
			arts.map((a) =>
				a.relPath.startsWith(PROCESSED_PREFIX)
					? a
					: { relPath: host.persistBlob(a.bytes, extname(a.relPath)), bytes: a.bytes },
			);
		const chainCtx: ChainCtx = { concurrency, emit, persist, original, warn, pIdx };

		const runOrReuse = async (unitAssets: ResolvedAsset[], units: WorkUnit[]): Promise<void> => {
			const key = unitKey(unitAssets, read, chainSig);
			const cached = host.getUnitCache(key);
			if (cached) {
				applyOps(registry, cached);
				return;
			}
			const ops = commit(await runChain(steps, units, chainCtx));
			host.setUnitCache(key, ops);
			applyOps(registry, ops);
		};

		if (hasFold) {
			// One cache entry for the whole group (a fold merges everything → one final unit).
			await runOrReuse(group, group.map(freshUnit));
		} else {
			// Map-only: each asset is an independent final unit → per-asset cache (incremental).
			await mapPool(group, concurrency, (a) => runOrReuse([a], [freshUnit(a)]));
		}
	}
}
