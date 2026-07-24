import type { AnnotationTarget, Note, TaskDomain } from "./types";

// Build a raw capture (.md + identity bundle) from a domain-group of Notes and POST it to the host's dev
// endpoint, which writes the files. Generic — no game-specific knowledge.

// ── Runtime config (read from the dev endpoint, so NOTHING project-specific is baked into emitted
// tasks) ─────────────────────────────────────────────────────────────────────────────────────────
// The overlay reads GET /__marksman/config once (cached) and threads the adopter's real values —
// their test/gate commands, where tasks + assets land — into every emitted task. Defaults are
// tool-generic so the overlay still works before a project config has been written.

export interface EmitConfig {
	/** The project's real gate commands, emitted verbatim as `done_when` lines (e.g. "npm test passes").
	 *  Empty = no project gate; the generic lint + "each note addressed" lines are always appended. */
	doneWhen: string[];
	/** Where per-task assets (screenshot.png, annotations.json) are written. */
	assetsDir: string;
	/** Voice-recorder gating for the overlay (client-facing subset — whisper paths live server-side).
	 *  `enabled` mirrors whether the optional **audio feature** is enabled (`features.audio`); it shows/
	 *  hides every 🎙 mic button. `vocabularyPrompt` biases whisper toward the project's domain words. */
	recording: { enabled: boolean; vocabularyPrompt: string };
}

export const DEFAULT_EMIT_CONFIG: EmitConfig = {
	doneWhen: [],
	assetsDir: ".cache/markdown/assets",
	recording: { enabled: false, vocabularyPrompt: "" },
};

/** Map a raw marksman.config.json (as served by GET /__marksman/config) onto the emit-time subset.
 *  Exported for unit testing; the overlay uses `loadConfig` (which caches this). */
export function normalizeConfig(raw: unknown): EmitConfig {
	const c = (raw ?? {}) as {
		doneWhen?: unknown;
		assetsDir?: unknown;
		recording?: { vocabularyPrompt?: unknown };
		features?: { audio?: unknown };
	};
	const doneWhen = Array.isArray(c.doneWhen)
		? c.doneWhen.map(String)
		: typeof c.doneWhen === "string" && c.doneWhen
			? [c.doneWhen]
			: [];
	return {
		doneWhen,
		assetsDir: typeof c.assetsDir === "string" && c.assetsDir ? c.assetsDir : DEFAULT_EMIT_CONFIG.assetsDir,
		recording: {
			// Gated on the optional audio feature — the mic buttons only appear once `features.audio` is on
			// (runtime status then gates whether the model is actually reachable).
			enabled: c.features?.audio === true,
			vocabularyPrompt:
				typeof c.recording?.vocabularyPrompt === "string"
					? c.recording.vocabularyPrompt
					: DEFAULT_EMIT_CONFIG.recording.vocabularyPrompt,
		},
	};
}

let _configCache: EmitConfig | null = null;

/** Load the runtime emit config from the dev endpoint (cached for the session). Never throws — falls
 *  back to tool-generic defaults if the endpoint or config file is absent. */
export async function loadConfig(endpoint = "/__marksman/config"): Promise<EmitConfig> {
	if (_configCache) return _configCache;
	try {
		const res = await fetch(endpoint);
		if (res.ok) {
			const json = (await res.json()) as { config?: unknown };
			_configCache = normalizeConfig(json.config);
			return _configCache;
		}
	} catch {
		// endpoint down / non-web host — fall through to defaults
	}
	_configCache = { ...DEFAULT_EMIT_CONFIG };
	return _configCache;
}

/** Render the `done_when` YAML lines: the project's real gates first, then the always-on lint + verify
 *  lines. `verify` is the per-task tail (e.g. "each note below is addressed …"). Exported so an optional
 *  feature can build tasks that read exactly like markup tasks to whatever processes them. */
export function doneWhenLines(cfg: EmitConfig, verify: string): string {
	return [
		...cfg.doneWhen.map((d) => `  - "${d}"`),
		'  - "no NEW lint errors/diagnostics introduced by the diff"',
		`  - "${verify}"`,
	].join("\n");
}

function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "markup"
	);
}

function rand(): string {
	return Math.random().toString(36).slice(2, 6);
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = () => res(r.result as string);
		r.onerror = rej;
		r.readAsDataURL(blob);
	});
}

/** Conflict-hint `area` (distinct from `domain`, which steers how the task is processed): UI tasks key
 *  on the screen so same-screen tasks serialize at the finish-line rebase; non-UI key on the domain. */
function areaFor(domain: TaskDomain, screen: string): string {
	if (domain === "ui") return screen && screen !== "game" ? `ui-${slugify(screen)}` : "ui-markup";
	return domain;
}

/** Human-readable description of a resolved target. Exported so an optional feature can describe
 *  targets with the exact same vocabulary as core markup tasks. */
export function targetDesc(t: AnnotationTarget): string {
	if (t.layer === "dom") {
		return `UI \`${t.component ?? t.selector}\`${t.sourceFile ? ` — ${t.sourceFile}` : ""}`;
	}
	return `entity type ${t.entityType} — \`${t.configPath}\``;
}
export function buildBundle(
	slug: string,
	screen: string,
	notes: Note[],
	area: string,
	domain: TaskDomain,
) {
	return {
		tool: "marksman",
		slug,
		screen,
		area,
		domain,
		viewport: { w: window.innerWidth, h: window.innerHeight },
		notes: notes.map((n) => ({
			comment: n.comment,
			domain: n.domain,
			target: n.target ?? null,
			enclosed: n.enclosed ?? [],
			sketches: n.sketches.length,
			sketchPointsAt: (n.sketchTargets ?? []).filter(Boolean),
			texts: n.texts.map((t) => t.text),
		})),
	};
}

/** Build the RAW capture record for a markup bundle — no shaping, no classification, no scoping. Just the
 *  captured note text + on-screen labels + pointers to the sidecar screenshot/annotations. Mirrors the
 *  `marksman-create-task` skill's raw dump (`source: marksman` / `raw: true`); a later step turns it into a
 *  real task. The resolved per-note targets live in the annotations.json bundle, not here. */
export function buildMarkdown(
	slug: string,
	notes: Note[],
	cfg: EmitConfig = DEFAULT_EMIT_CONFIG,
): string {
	const assets = `${cfg.assetsDir}/${slug}`;
	const list =
		notes
			.map((n, i) => {
				const parts = [`${i + 1}. ${n.comment || "(no comment)"}`];
				if (n.texts.length)
					parts.push(`   - on-screen text: ${n.texts.map((t) => `"${t.text}"`).join(", ")}`);
				return parts.join("\n");
			})
			.join("\n") || "(none)";
	return `---
source: marksman
raw: true
---

${list}

- screenshot: \`${assets}/screenshot.png\`
- annotations (resolved target per note): \`${assets}/annotations.json\`
`;
}

export async function sendTask(opts: {
	title: string;
	screen: string;
	notes: Note[];
	screenshot: Blob;
	domain?: TaskDomain;
	endpoint?: string;
}): Promise<{ slug: string; path: string }> {
	// domain/screen/area are still captured into the sidecar bundle as routing HINTS for the later
	// processing step — they are no longer promoted into the raw task markdown.
	const domain = opts.domain ?? "design";
	const area = areaFor(domain, opts.screen);
	const slug = `${slugify(opts.title)}-${rand()}`;
	const screenshotDataUrl = await blobToDataUrl(opts.screenshot);
	const cfg = await loadConfig();
	const bundle = buildBundle(slug, opts.screen, opts.notes, area, domain);
	const markdown = buildMarkdown(slug, opts.notes, cfg);
	const res = await fetch(opts.endpoint ?? "/__marksman/task", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ slug, markdown, bundle, screenshotDataUrl }),
	});
	if (!res.ok) throw new Error(`emit failed: HTTP ${res.status}`);
	const json = (await res.json()) as { slug: string; path: string };
	return { slug: json.slug, path: json.path };
}

/** A unique kebab slug for a task. */
export function taskSlug(title: string): string {
	return `${slugify(title)}-${rand()}`;
}

/** POST a pre-built task (markdown + bundle, optional screenshot) to the host endpoint. Generic — used
 *  for non-markup tasks like "apply this Style". */
export async function postTask(
	payload: { slug: string; markdown: string; bundle: unknown; screenshotDataUrl?: string },
	endpoint = "/__marksman/task",
): Promise<{ slug: string; path: string }> {
	const res = await fetch(endpoint, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!res.ok) throw new Error(`postTask failed: HTTP ${res.status}`);
	return (await res.json()) as { slug: string; path: string };
}

/** A short title from a raw transcript: first sentence (if short) else a word-safe truncation. */
function transcriptTitle(t: string): string {
	const oneLine = t.replace(/\s+/g, " ").trim();
	if (!oneLine) return "voice transcript";
	const base = (oneLine.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? oneLine).replace(/[.!?]+$/, "");
	if (base.length <= 60) return base;
	const cut = base.slice(0, 60);
	const sp = cut.lastIndexOf(" ");
	return `${(sp > 24 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Build the RAW capture record from a voice transcript — no marks, no screenshot, no shaping. Just the
 *  verbatim transcript under `source: marksman` / `raw: true`; the later processing step infers intent +
 *  domain from the words. Exported for testing; used by the overlay's passive voice recorder. */
export function buildTranscriptMarkdown(transcript: string): string {
	return `---
source: marksman
raw: true
---

${transcript}
`;
}

/** Send a raw voice transcript as a capture through the SAME endpoint as marked tasks (no note/screenshot). */
export async function sendTranscript(opts: {
	transcript: string;
	title?: string;
	endpoint?: string;
}): Promise<{ slug: string; path: string }> {
	const transcript = opts.transcript.trim();
	const title = opts.title?.trim() || transcriptTitle(transcript);
	const slug = taskSlug(title);
	const markdown = buildTranscriptMarkdown(transcript);
	const bundle = { tool: "marksman", slug, kind: "transcript", transcript };
	return postTask({ slug, markdown, bundle }, opts.endpoint ?? "/__marksman/task");
}

/** Load a repo doc (e.g. a UI rules doc) via the host endpoint. Returns "" if missing. */
export async function loadDoc(path: string, endpoint = "/__marksman/doc"): Promise<string> {
	const res = await fetch(`${endpoint}?path=${encodeURIComponent(path)}`);
	if (!res.ok) return "";
	const json = (await res.json()) as { content?: string };
	return json.content ?? "";
}

/** Save a repo doc via the host endpoint (host whitelists writable paths). */
export async function saveDoc(
	path: string,
	content: string,
	endpoint = "/__marksman/doc",
): Promise<void> {
	const res = await fetch(endpoint, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path, content }),
	});
	if (!res.ok) throw new Error(`saveDoc failed: HTTP ${res.status}`);
}
