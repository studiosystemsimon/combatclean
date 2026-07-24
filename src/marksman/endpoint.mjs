// Marksman — dev-server endpoint (game-agnostic). DEV ONLY.
//
// This is the local file-write backend behind the Marksman markup overlay + task pipeline. Vendored
// into this game as in-repo source (not an npm dependency) so it's yours to edit — see ./README.md.
// Registered as a Vite plugin (apply: "serve") in vite.config.ts, so it exists only on the dev server
// and never ships in `npm run build`. The overlay's "Send" button POSTs a marked-up task here and we
// WRITE a task file + its screenshot / annotation bundle into the capture inbox (.cache/markdown/).
// There is NO LLM/API call — every route is a plain local file read or write; turning a capture into
// a code change is a separate, explicit step (the transcript-to-changeset / run-changeset pipeline).
//
// Core routes (all under /__marksman/):
//   POST  task               write inbox/<slug>.md + assets/<slug>/{annotations.json, screenshot.png, images[]}
//   GET   config             read the resolved marksman.config.json → { config }   (runtime reads this)
//   GET   doc                read a whitelisted doc  (?path=)        → { content }
//   PUT   doc                write a whitelisted doc (atomic temp→rename) { path, content } → { ok }
//   GET   browse             list dirs+files under a root-jailed rel path (?path=)
//   GET   assets/folders     list asset-pack subfolders on disk, with a thumbnail + image count (?root=)
//   GET   file               stream a whitelisted image (thumbnails) (?path=)
//
// Optional features contribute more routes + doc-whitelist prefixes via `opts.features` — e.g. the
// audio feature's transcription routes (./features/audio/server.mjs). Pass each enabled feature's
// route contribution in (see vite.config.ts, which wires this conditionally on the audio config):
//
//   import marksmanEndpoint from "./src/marksman/endpoint.mjs";
//   import { audioRoutes } from "./src/marksman/features/audio/server.mjs";
//   export default defineConfig({ plugins: [marksmanEndpoint({ features: [audioRoutes] })] });
//
// Safety: every path is jailed to `root` and rejects ".." traversal; the doc routes additionally require
// a whitelisted prefix; doc PUT is atomic (temp file + rename) so a reader/crash never sees a half write.
//
// Two entry points so it works in any web host:
//   (a) marksmanEndpoint(opts)          — a Vite plugin (apply: "serve"). Used by vite.config.ts.
//   (b) createMarksmanMiddleware(opts)  — a plain Node (req, res, next) handler for non-Vite hosts
//                                         (Express/Connect/Polka/raw http).
// Both share the exact same route handlers, so behaviour is identical regardless of host.
//
// Nothing here is repo-specific: project root, inbox/assets dirs, the doc read/write whitelist, the
// asset-pack browse root, and the config file path are ALL supplied via `opts` (with tool-generic
// defaults). No project-specific names or paths are hardcoded.

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Options + defaults
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MarksmanFeatureRoutes
 * @property {Array<[string, Function]>} [routes]        Extra `[pathname, handler]` pairs (same shape as
 *                                                        core's, `async (cfg, req, res) => handled`).
 * @property {string[]}                  [docWhitelist]   Extra doc GET/PUT path prefixes this feature needs.
 */

/**
 * @typedef {Object} MarksmanOptions
 * @property {string}   [root]          Project root that all paths resolve against. Default: process.cwd().
 * @property {string}   [configPath]    marksman.config.json location, relative to root. Default: "marksman.config.json".
 * @property {string}   [inboxDir]      Where task markdown lands, relative to root. Default: ".cache/markdown".
 * @property {string}   [assetsDir]     Where per-task assets land, relative to root. Default: ".cache/markdown/assets".
 * @property {string[]} [docWhitelist]  Allowed path PREFIXES (relative to root) for doc GET/PUT — the
 *                                      doc read/write path jail. Core default is tool-generic ONLY:
 *                                      [".cache/markdown/"]. Each entry in `features` may contribute
 *                                      more; the "no .." traversal jail always applies on top.
 * @property {string}   [assetRoot]     Default root for the asset-pack folder browser, relative to root. Each
 *                                      request may override it via ?root=. Default: "" (none).
 * @property {MarksmanFeatureRoutes[]} [features]  Route + doc-whitelist contributions from enabled
 *                                      optional features (see ./features/*\/server.mjs). Default: [].
 */

/** Resolve user options to a fully-populated, normalized config object. */
function resolveOptions(opts = {}) {
	const features = Array.isArray(opts.features) ? opts.features : [];
	return {
		root: opts.root ?? process.cwd(),
		configPath: opts.configPath ?? "marksman.config.json",
		inboxDir: opts.inboxDir ?? ".cache/markdown",
		assetsDir: opts.assetsDir ?? ".cache/markdown/assets",
		// Normalize each prefix to forward slashes (compared against forward-slashed request paths).
		docWhitelist: [
			".cache/markdown/",
			...(opts.docWhitelist ?? []),
			...features.flatMap((f) => f?.docWhitelist ?? []),
		].map((p) => String(p).replace(/\\/g, "/")),
		assetRoot: opts.assetRoot ?? "",
		features,
	};
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Small request/response helpers (host-agnostic — work for both Vite middlewares and raw http)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const IMG = /\.(png|jpe?g|webp|gif)$/i;

/** Read a request body to a string. */
function readBody(req) {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => resolve(body));
	});
}

/** Parse the request URL into a URL object (req.originalUrl preferred — Connect strips the mount prefix
 *  from req.url). The host part is a throwaway base; we only read pathname + searchParams. */
function reqUrl(req) {
	return new URL(req.originalUrl || req.url || "", "http://localhost");
}

/** JSON response shorthand. */
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(payload));
}

/** Reject a path that escapes the root or isn't under one of the whitelisted prefixes. */
function isWhitelistedDoc(p, whitelist) {
	if (typeof p !== "string" || p.includes("..")) return false;
	const norm = p.replace(/\\/g, "/");
	return whitelist.some((prefix) => norm.startsWith(prefix));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Core route handlers — pure (config, req, res) functions, reused by BOTH exports.
// Each returns true if it handled the request (so the standalone middleware can fall through to next()).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** GET /__marksman/config — read the resolved marksman.config.json so the RUNTIME is config-driven
 *  (emitted task `done_when`, inbox/assets paths, uiCraft). Missing file → a tool-generic default so the
 *  overlay still works before a project config has been written. */
async function handleConfig(cfg, req, res) {
	res.setHeader("content-type", "application/json");
	const fallback = {
		inboxDir: cfg.inboxDir,
		assetsDir: cfg.assetsDir,
		doneWhen: [],
		uiCraft: false,
	};
	try {
		const raw = await readFile(join(cfg.root, cfg.configPath), "utf8");
		const parsed = JSON.parse(raw);
		// Drop the human-facing `_comment` block; merge over the fallback so partial configs still resolve.
		const { _comment, ...config } = parsed;
		res.end(JSON.stringify({ config: { ...fallback, ...config } }));
	} catch {
		res.end(JSON.stringify({ config: fallback }));
	}
	return true;
}

/** POST /__marksman/task — write inbox/<slug>.md + assets/<slug>/{annotations.json, screenshot.png, images[]}. */
async function handleTask(cfg, req, res) {
	if (req.method !== "POST") {
		res.statusCode = 405;
		res.end("method not allowed");
		return true;
	}
	try {
		const body = await readBody(req);
		const { slug, markdown, bundle, screenshotDataUrl, images } = JSON.parse(body);
		// Slug becomes a filename + a folder name — strip everything that isn't safe.
		const safe = String(slug || "markup").replace(/[^a-z0-9-]/gi, "-");
		const inbox = join(cfg.root, cfg.inboxDir);
		const assets = join(cfg.root, cfg.assetsDir, safe);
		await mkdir(inbox, { recursive: true });
		await mkdir(assets, { recursive: true });

		// The task markdown (what the later processing step reads).
		await writeFile(join(inbox, `${safe}.md`), String(markdown ?? ""), "utf8");
		// The identity bundle (resolved DOM/canvas targets, enclosed set, sketch targets, etc.).
		await writeFile(join(assets, "annotations.json"), JSON.stringify(bundle ?? {}, null, 2), "utf8");

		// The composite screenshot, sent as a data URL ("data:image/png;base64,....").
		const b64 = String(screenshotDataUrl ?? "").split(",")[1] ?? "";
		if (b64) await writeFile(join(assets, "screenshot.png"), Buffer.from(b64, "base64"));

		// Extra images (optional additional screenshots) — accept only safe image filenames, never traversal.
		for (const img of Array.isArray(images) ? images : []) {
			const name = String(img?.name ?? "");
			if (!/^[\w.-]+\.(png|jpe?g|webp)$/i.test(name)) continue;
			const ib64 = String(img?.dataUrl ?? "").split(",")[1] ?? "";
			if (ib64) await writeFile(join(assets, name), Buffer.from(ib64, "base64"));
		}

		sendJson(res, 200, { ok: true, slug: safe, path: `${cfg.inboxDir}/${safe}.md` });
	} catch (e) {
		sendJson(res, 500, { ok: false, error: String(e) });
	}
	return true;
}

/** GET|PUT /__marksman/doc — read/write a whitelisted doc under the task-output tree (or any prefix an
 *  enabled feature adds). GET ?path=...  → { content }.  PUT { path, content } → { ok }. Whitelisted prefixes
 *  only, no traversal — see `resolveOptions` for how the whitelist is assembled from core + features. */
async function handleDoc(cfg, req, res) {
	res.setHeader("content-type", "application/json");
	const u = reqUrl(req);

	if (req.method === "GET") {
		const p = u.searchParams.get("path");
		if (!isWhitelistedDoc(p, cfg.docWhitelist)) {
			sendJson(res, 400, { error: "bad path" });
			return true;
		}
		try {
			const content = await readFile(join(cfg.root, p), "utf8");
			res.end(JSON.stringify({ content }));
		} catch {
			// Missing doc → empty string (the hub treats "not yet written" as blank, not an error).
			res.end(JSON.stringify({ content: "" }));
		}
		return true;
	}

	if (req.method === "PUT") {
		try {
			const body = await readBody(req);
			const { path, content } = JSON.parse(body);
			if (!isWhitelistedDoc(path, cfg.docWhitelist)) {
				sendJson(res, 400, { error: "bad path" });
				return true;
			}
			const full = join(cfg.root, path);
			await mkdir(dirname(full), { recursive: true });
			// Atomic: temp-then-rename so a reader (or a crash) never sees a half-written guide file.
			const tmp = `${full}.tmp`;
			await writeFile(tmp, String(content ?? ""), "utf8");
			await rename(tmp, full);
			res.end(JSON.stringify({ ok: true }));
		} catch (e) {
			sendJson(res, 500, { ok: false, error: String(e) });
		}
		return true;
	}

	sendJson(res, 405, { error: "method not allowed" });
	return true;
}

/** GET /__marksman/browse?path=<rel> — list dirs + files under a rel path (root-jailed, no traversal).
 *  Powers the Asset Picker's "Browse files…" navigator so a folder/file can be picked directly. */
async function handleBrowse(cfg, req, res) {
	res.setHeader("content-type", "application/json");
	const rel = (reqUrl(req).searchParams.get("path") || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (rel.includes("..")) {
		sendJson(res, 400, { error: "bad path", entries: [] });
		return true;
	}
	try {
		const items = await readdir(join(cfg.root, rel), { withFileTypes: true });
		const entries = items
			.filter((it) => !it.name.startsWith("."))
			.map((it) => ({ name: it.name, rel: (rel ? `${rel}/` : "") + it.name, dir: it.isDirectory() }))
			.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
		res.end(JSON.stringify({ path: rel, parent: rel ? rel.split("/").slice(0, -1).join("/") : null, entries }));
	} catch {
		res.end(JSON.stringify({ path: rel, parent: null, entries: [] }));
	}
	return true;
}

// Bounded recursive scans for the folder browser — find one sample image + count images per folder.
async function findImage(dir, depth) {
	if (depth > 3) return null;
	let items;
	try {
		items = await readdir(dir, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const it of items) if (it.isFile() && IMG.test(it.name)) return join(dir, it.name);
	for (const it of items) {
		if (it.isDirectory()) {
			const f = await findImage(join(dir, it.name), depth + 1);
			if (f) return f;
		}
	}
	return null;
}
async function countImages(dir, depth, budget) {
	if (depth > 3 || budget <= 0) return 0;
	let items;
	try {
		items = await readdir(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	let n = 0;
	for (const it of items) {
		if (n >= budget) break;
		if (it.isFile() && IMG.test(it.name)) n++;
		else if (it.isDirectory()) n += await countImages(join(dir, it.name), depth + 1, budget - n);
	}
	return n;
}

/** GET /__marksman/assets/folders[?root=...] — list subfolders of the asset-pack root ON DISK (so local,
 *  git-ignored packs show up). Each folder card gets a sample image (for a thumbnail) + an image count.
 *  ?root overrides cfg.assetRoot for this request (still rejected if it tries to traverse out of root). */
async function handleAssetFolders(cfg, req, res) {
	res.setHeader("content-type", "application/json");
	const u = reqUrl(req);
	const root = u.searchParams.get("root") || cfg.assetRoot;
	if (!root || root.includes("..")) {
		sendJson(res, 400, { error: "bad root", folders: [] });
		return true;
	}
	const toRel = (abs) => relative(cfg.root, abs).replace(/\\/g, "/");
	const base = join(cfg.root, root);
	let entries;
	try {
		entries = await readdir(base, { withFileTypes: true });
	} catch {
		res.end(JSON.stringify({ root, folders: [], error: "root not found" }));
		return true;
	}
	const folders = [];
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const dir = join(base, e.name);
		const img = await findImage(dir, 0);
		folders.push({
			name: e.name,
			relPath: `${root}/${e.name}`.replace(/\\/g, "/"),
			thumb: img ? toRel(img) : null,
			count: await countImages(dir, 0, 500),
		});
	}
	res.end(JSON.stringify({ root, folders }));
	return true;
}

/** GET /__marksman/file?path=... — stream a whitelisted image (thumbnails for the folder browser).
 *  Image extensions only, no traversal; served relative to root. */
async function handleFile(cfg, req, res) {
	const u = reqUrl(req);
	const p = u.searchParams.get("path") || "";
	if (!p || p.includes("..") || !IMG.test(p)) {
		res.statusCode = 400;
		res.end("bad path");
		return true;
	}
	const ext = p.split(".").pop().toLowerCase();
	const mime =
		ext === "png"
			? "image/png"
			: ext === "webp"
				? "image/webp"
				: ext === "gif"
					? "image/gif"
					: "image/jpeg";
	try {
		const buf = await readFile(join(cfg.root, p));
		res.setHeader("content-type", mime);
		res.end(buf);
	} catch {
		res.statusCode = 404;
		res.end("not found");
	}
	return true;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Core route table — pathname → handler. Feature route contributions are appended to this per-instance
// (see resolveOptions/buildRoutes), so "/__marksman/assets/folders" and any feature route registered
// later aren't shadowed by a less specific core prefix.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const CORE_ROUTES = [
	["/__marksman/task", handleTask],
	["/__marksman/config", handleConfig],
	["/__marksman/doc", handleDoc],
	["/__marksman/browse", handleBrowse],
	["/__marksman/assets/folders", handleAssetFolders],
	["/__marksman/file", handleFile],
];

/** Core routes + whatever each enabled feature contributes (see `MarksmanOptions.features`). */
function buildRoutes(cfg) {
	return [...CORE_ROUTES, ...cfg.features.flatMap((f) => f?.routes ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (b) Standalone Node middleware — (req, res, next) for non-Vite hosts.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Build a plain Node HTTP handler that serves the Marksman routes. Mount it on Express/Connect/Polka,
 * or call it directly from http.createServer((req, res) => mw(req, res)).
 *
 * Matches on the request PATHNAME (so query strings don't break routing). Requests that don't match a
 * Marksman route call next() (if provided) or 404 (raw http with no next).
 *
 * @param {MarksmanOptions} [opts]
 * @returns {(req, res, next?) => void}
 */
export function createMarksmanMiddleware(opts = {}) {
	const cfg = resolveOptions(opts);
	const routes = buildRoutes(cfg);
	return (req, res, next) => {
		const pathname = reqUrl(req).pathname;
		const route = routes.find(([p]) => p === pathname);
		if (!route) {
			if (typeof next === "function") return next();
			res.statusCode = 404;
			res.end("not found");
			return;
		}
		// Handlers are async; surface any unexpected rejection rather than hanging the socket.
		Promise.resolve(route[1](cfg, req, res)).catch((e) => {
			if (!res.writableEnded) sendJson(res, 500, { ok: false, error: String(e) });
		});
	};
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (a) Vite plugin — apply: "serve" (dev only). Mounts each route as its own path-mounted middleware.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Vite dev-server plugin that mounts the Marksman endpoint. Add to plugins[] in vite.config.* :
 *
 *   import marksmanEndpoint from "./src/marksman/endpoint.mjs";
 *   export default defineConfig({ plugins: [marksmanEndpoint()] });
 *
 * @param {MarksmanOptions} [opts]
 */
export function marksmanEndpoint(opts = {}) {
	const cfg = resolveOptions(opts);
	const routes = buildRoutes(cfg);
	return {
		name: "marksman-task-endpoint",
		apply: "serve",
		configureServer(server) {
			// server.middlewares.use(path, fn) mounts at a path prefix; the handlers own their own method
			// checks. One registration per route so exact pathnames aren't shadowed.
			for (const [path, handler] of routes) {
				server.middlewares.use(path, (req, res) => {
					Promise.resolve(handler(cfg, req, res)).catch((e) => {
						if (!res.writableEnded) sendJson(res, 500, { ok: false, error: String(e) });
					});
				});
			}
		},
	};
}

export default marksmanEndpoint;
