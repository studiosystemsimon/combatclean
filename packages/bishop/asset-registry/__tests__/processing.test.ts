import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	type AssetProcessor,
	type NamedBytes,
	PROCESSED_PREFIX,
	type ProcessingConfig,
	type ProcessingHost,
	clearAssetProcessors,
	globToRegExp,
	matchSelector,
	processRegistry,
	registerAssetProcessor,
} from "../src/processing.js";
import type { AssetRegistry, ResolvedAsset } from "../src/types.js";

// ─── fixtures ───

function asset(id: string, files: string[], type = "image"): ResolvedAsset {
	return { id, type, declaration: { type }, basePath: "", manifestPath: "m/assets.json", files };
}

function registry(...assets: ResolvedAsset[]): AssetRegistry {
	return new Map(assets.map((a) => [a.id, a]));
}

function get(reg: AssetRegistry, id: string): ResolvedAsset {
	const a = reg.get(id);
	if (!a) throw new Error(`missing asset ${id}`);
	return a;
}

/** In-memory host: source bytes from a map, blobs + cache in maps. */
function memHost(
	sources: Record<string, string>,
): ProcessingHost & { blobs: Map<string, Uint8Array> } {
	const blobs = new Map<string, Uint8Array>();
	const cache = new Map<string, unknown>();
	let n = 0;
	return {
		blobs,
		readSource: (rel) => new TextEncoder().encode(sources[rel] ?? ""),
		persistBlob(bytes, ext) {
			const name = `blob${n++}${ext}`;
			blobs.set(name, bytes);
			return PROCESSED_PREFIX + name;
		},
		getUnitCache: (k) => cache.get(k) as never,
		setUnitCache: (k, ops) => void cache.set(k, ops),
	};
}

afterEach(() => clearAssetProcessors());

// ─── glob / selector ───

describe("globToRegExp", () => {
	it("handles *, **, ?, braces, literal dot", () => {
		expect(globToRegExp("**/*.png").test("a/b/c.png")).toBe(true);
		expect(globToRegExp("**/*.png").test("c.png")).toBe(true);
		expect(globToRegExp("*.png").test("a/c.png")).toBe(false); // * doesn't cross /
		expect(globToRegExp("**/*.{png,jpg}").test("x/y.jpg")).toBe(true);
		expect(globToRegExp("ui.*").test("ui.button")).toBe(true);
		expect(globToRegExp("ui.*").test("uixbutton")).toBe(false); // dot is literal
	});
});

describe("matchSelector", () => {
	const a = asset("ui.button", ["ui/button.png"]);
	it("matches by path glob, id glob, regex", () => {
		expect(matchSelector(a, { path: [{ glob: "**/*.png" }] })).toBe(true);
		expect(matchSelector(a, { id: [{ glob: "ui.*" }] })).toBe(true);
		expect(matchSelector(a, { id: [{ regex: "^ui\\." }] })).toBe(true);
		expect(matchSelector(a, { path: [{ glob: "**/*.wav" }] })).toBe(false);
	});
	it("AND across dimensions, any-of within", () => {
		expect(matchSelector(a, { path: [{ glob: "**/*.png" }], id: [{ glob: "fx.*" }] })).toBe(false);
		expect(matchSelector(a, { id: [{ glob: "fx.*" }, { glob: "ui.*" }] })).toBe(true);
	});
});

// ─── fake processors ───

const noOpts = z.object({});

/** map: rewrite each file's extension via emit, merge a derived flag. */
function extProc(id: string, ext: string, accepts = { extensions: ["png"] }): AssetProcessor {
	return {
		id,
		kind: "map",
		accepts,
		optionsSchema: noOpts,
		async process({ artifacts, emit }) {
			const out: NamedBytes[] = artifacts.map((a) => {
				const bytes = new TextEncoder().encode(`${id}:${a.relPath}`);
				return { relPath: emit(a.relPath.replace(/\.[^.]+$/, ext), bytes), bytes };
			});
			return { artifacts: out, derived: { [id]: true } };
		},
	};
}

/** fold: pack members into one sheet, each binding gets a rect, plus a sheet asset. */
function packProc(id: string, sheetId: string): AssetProcessor {
	return {
		id,
		kind: "fold",
		accepts: { extensions: ["png", "webp"] },
		optionsSchema: noOpts,
		async process({ members, emit }) {
			const sheet = emit("sheet.png", new TextEncoder().encode("SHEET"));
			return {
				artifacts: [{ relPath: sheet, bytes: new TextEncoder().encode("SHEET") }],
				sheetAsset: { id: sheetId, declaration: { type: "sprite-atlas" } },
				bindings: members.map((m, i) => ({
					assetId: m.assetId,
					derived: { rect: { x: i * 10, y: 0, w: 10, h: 10 } },
				})),
			};
		},
	};
}

const cfg = (pipelines: ProcessingConfig["p"]): ProcessingConfig => ({ p: pipelines });

async function run(
	reg: AssetRegistry,
	config: ProcessingConfig,
	host: ProcessingHost,
): Promise<string[]> {
	const warnings: string[] = [];
	await processRegistry(reg, {
		root: "/root",
		profile: "p",
		config,
		host,
		warn: (m) => warnings.push(m),
	});
	return warnings;
}

// ─── runner ───

describe("processRegistry — map", () => {
	it("transforms 1→1: files swapped to @proc, derived merged", async () => {
		registerAssetProcessor(extProc("image-webp", ".webp"));
		const reg = registry(asset("hero", ["hero.png"]));
		const host = memHost({ "hero.png": "PNG" });
		await run(
			reg,
			cfg([{ match: { id: [{ glob: "hero" }] }, steps: [{ use: "image-webp" }] }]),
			host,
		);

		const hero = get(reg, "hero");
		expect(hero.files).toHaveLength(1);
		expect(hero.files[0].startsWith(PROCESSED_PREFIX)).toBe(true);
		expect(hero.files[0].endsWith(".webp")).toBe(true);
		expect(hero.derived).toMatchObject({ "image-webp": true });
	});

	it("warn+skips an accepts mismatch, leaves the asset untouched", async () => {
		registerAssetProcessor(extProc("image-webp", ".webp", { extensions: ["png"] }));
		const reg = registry(asset("sfx", ["sfx.wav"]));
		const host = memHost({ "sfx.wav": "WAV" });
		const warns = await run(
			reg,
			cfg([{ match: { path: [{ glob: "**/*.wav" }] }, steps: [{ use: "image-webp" }] }]),
			host,
		);
		expect(get(reg, "sfx").files).toEqual(["sfx.wav"]);
		expect(warns.some((w) => w.includes("accepts mismatch"))).toBe(true);
	});
});

describe("processRegistry — fold (redirect to shared sheet, id immutable)", () => {
	it("points every member at the shared sheet file with its OWN rect (a packed frame is NOT an alias)", async () => {
		registerAssetProcessor(packProc("frames-pack", "ui-atlas"));
		const reg = registry(asset("ui.a", ["ui/a.png"]), asset("ui.b", ["ui/b.png"]));
		const host = memHost({ "ui/a.png": "A", "ui/b.png": "B" });
		await run(
			reg,
			cfg([{ match: { id: [{ glob: "ui.*" }] }, steps: [{ use: "frames-pack" }] }]),
			host,
		);

		const a = get(reg, "ui.a");
		const b = get(reg, "ui.b");
		expect(a.files).toEqual(b.files); // same shared sheet file
		expect(a.files[0].startsWith(PROCESSED_PREFIX)).toBe(true);
		// a packed frame is a REAL asset (its own rect), NOT an aliasOf redirect
		expect(a.aliasOf).toBeUndefined();
		expect(b.aliasOf).toBeUndefined();
		expect(a.derived).toMatchObject({ rect: { x: 0 } });
		expect(b.derived).toMatchObject({ rect: { x: 10 } });
		// ids never changed
		expect(reg.has("ui.a") && reg.has("ui.b")).toBe(true);
		// standalone sheet asset added
		expect(get(reg, "ui-atlas").type).toBe("sprite-atlas");
		expect(get(reg, "ui-atlas").files).toEqual(a.files);
	});
});

describe("processRegistry — chain map→fold→map", () => {
	it("resize → pack → reformat runs the reformat ONCE over the shared sheet", async () => {
		registerAssetProcessor(extProc("resize", ".png"));
		registerAssetProcessor(packProc("frames-pack", "ui-atlas"));
		const webp = extProc("image-webp", ".webp", { extensions: ["png"] });
		const spy = vi.spyOn(webp, "process");
		registerAssetProcessor(webp);

		const reg = registry(asset("ui.a", ["ui/a.png"]), asset("ui.b", ["ui/b.png"]));
		const host = memHost({ "ui/a.png": "A", "ui/b.png": "B" });
		await run(
			reg,
			cfg([
				{
					match: { id: [{ glob: "ui.*" }] },
					steps: [{ use: "resize" }, { use: "frames-pack" }, { use: "image-webp" }],
				},
			]),
			host,
		);

		expect(spy).toHaveBeenCalledTimes(1); // one sheet, not per-member
		const a = get(reg, "ui.a");
		expect(a.files[0].endsWith(".webp")).toBe(true);
		expect(get(reg, "ui.b").files).toEqual(a.files);
	});
});

describe("processRegistry — guards & cache", () => {
	it("errors when two pipelines select the same asset", async () => {
		registerAssetProcessor(extProc("image-webp", ".webp"));
		const reg = registry(asset("hero", ["hero.png"]));
		const host = memHost({ "hero.png": "PNG" });
		await expect(
			run(
				reg,
				cfg([
					{ match: { id: [{ glob: "hero" }] }, steps: [{ use: "image-webp" }] },
					{ match: { path: [{ glob: "**/*.png" }] }, steps: [{ use: "image-webp" }] },
				]),
				host,
			),
		).rejects.toThrow(/ambiguous/);
	});

	it("a cache hit skips re-processing", async () => {
		const webp = extProc("image-webp", ".webp");
		const spy = vi.spyOn(webp, "process");
		registerAssetProcessor(webp);
		const host = memHost({ "hero.png": "PNG" });
		const config = cfg([{ match: { id: [{ glob: "hero" }] }, steps: [{ use: "image-webp" }] }]);

		const reg1 = registry(asset("hero", ["hero.png"]));
		await run(reg1, config, host);
		const reg2 = registry(asset("hero", ["hero.png"]));
		await run(reg2, config, host); // same host → cache hit

		expect(spy).toHaveBeenCalledTimes(1); // second run served from cache
		expect(get(reg2, "hero").files[0].endsWith(".webp")).toBe(true); // still patched
	});

	it("bad options fail the build before processing", async () => {
		registerAssetProcessor({
			id: "needs-q",
			kind: "map",
			accepts: { extensions: ["png"] },
			optionsSchema: z.object({ q: z.number() }),
			process: async ({ artifacts }) => ({ artifacts }),
		});
		const reg = registry(asset("hero", ["hero.png"]));
		const host = memHost({ "hero.png": "PNG" });
		await expect(
			run(
				reg,
				cfg([{ match: { id: [{ glob: "hero" }] }, steps: [{ use: "needs-q", options: {} }] }]),
				host,
			),
		).rejects.toThrow(/bad options/);
	});

	it("persists an artifact a processor returned WITHOUT calling emit (no dangling files)", async () => {
		registerAssetProcessor({
			id: "raw-return",
			kind: "map",
			accepts: { extensions: ["png"] },
			optionsSchema: noOpts,
			// returns bytes with a PLAIN relPath, never calls emit — the runner must persist it.
			process: async ({ artifacts }) => ({
				artifacts: artifacts.map((a) => ({
					relPath: a.relPath.replace(/\.png$/, ".out"),
					bytes: new TextEncoder().encode("X"),
				})),
			}),
		});
		const reg = registry(asset("hero", ["hero.png"]));
		const host = memHost({ "hero.png": "PNG" });
		await run(
			reg,
			cfg([{ match: { id: [{ glob: "hero" }] }, steps: [{ use: "raw-return" }] }]),
			host,
		);

		expect(get(reg, "hero").files[0].startsWith(PROCESSED_PREFIX)).toBe(true);
		expect(host.blobs.size).toBe(1); // runner persisted the returned bytes
	});

	it("busts the cache when only the DECLARATION changes (bytes unchanged)", async () => {
		const webp = extProc("image-webp", ".webp");
		const spy = vi.spyOn(webp, "process");
		registerAssetProcessor(webp);
		const host = memHost({ "hero.png": "PNG" });
		const config = cfg([{ match: { id: [{ glob: "hero" }] }, steps: [{ use: "image-webp" }] }]);

		await run(registry(asset("hero", ["hero.png"])), config, host);
		const changed = asset("hero", ["hero.png"]);
		changed.declaration = { type: "image", extra: 1 }; // same bytes, different declaration
		await run(new Map([["hero", changed]]), config, host);

		expect(spy).toHaveBeenCalledTimes(2); // declaration is in the key → miss → reprocessed
	});
});
