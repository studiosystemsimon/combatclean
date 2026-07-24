// Shared element-resolution helpers for the markup overlay. Pure-ish helpers that take the game canvas
// + adapter; no component state. This is the canonical copy — the overlay (Marksman.tsx) imports these
// rather than keeping its own inline copies.
import type { AnnotationTarget, DomTarget, GameAdapter, Point } from "./types";

/** Overlay chrome to ignore when hit-testing (markup toolbars/panels). */
export const OWN_CHROME = ".mk-bar, .mk-editor, .mk-notes, .mk-modal, .mk-fab";

export function bbox(pts: Point[]) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function cssPath(el: Element): string {
	const parts: string[] = [];
	let node: Element | null = el;
	for (let depth = 0; node && depth < 5 && node !== document.body; depth++) {
		if (node.id) {
			parts.unshift(`#${node.id}`);
			break;
		}
		let sel = node.tagName.toLowerCase();
		const cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean)[0];
		if (cls) sel += `.${cls}`;
		const parent = node.parentElement;
		if (parent) {
			const sibs = Array.from(parent.children).filter((c) => c.tagName === node?.tagName);
			if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
		}
		parts.unshift(sel);
		node = node.parentElement;
	}
	return parts.join(" > ");
}

const baseName = (file: string, ext?: RegExp): string | undefined =>
	file.split(/[\\/]/).pop()?.replace(ext ?? /\.[a-z]+$/i, "");

/** React (dev): nearest `_debugSource` up the fiber's owner chain → "file:line". Version-dependent —
 *  React <19 expose `_debugSource`; newer builds may not, so this degrades to component-name-only. */
export function reactSource(fiber: unknown): string | undefined {
	let f = fiber as { _debugSource?: { fileName?: string; lineNumber?: number }; _debugOwner?: unknown } | null;
	for (let i = 0; f && i < 30; i++) {
		const s = f._debugSource;
		if (s?.fileName) return `${s.fileName}:${s.lineNumber ?? 0}`;
		f = f._debugOwner as typeof f;
	}
	return undefined;
}
/** React: nearest component (function/class) name walking up the fiber tree (host fibers have string types). */
export function reactComponentName(fiber: unknown): string | undefined {
	let f = fiber as { type?: unknown; elementType?: unknown; return?: unknown } | null;
	for (let i = 0; f && i < 30; i++) {
		const raw = f.type ?? f.elementType; // a host fiber's type is a string tag; a component fiber's is a fn/class
		if (typeof raw === "function") {
			const fn = raw as { displayName?: string; name?: string };
			return fn.displayName || fn.name || undefined;
		}
		if (raw && typeof raw === "object") {
			const o = raw as { displayName?: string; name?: string };
			if (o.displayName || o.name) return o.displayName || o.name;
		}
		f = f.return as typeof f;
	}
	return undefined;
}

/** Per-element framework metadata (component + source `file:line`) in DEV builds. Tries Svelte → Vue 3 →
 *  React — whichever the host uses — so DOM marks resolve to a real component/source on any of them, not just
 *  Svelte. Returns null if none present (caller falls back to the CSS selector). Production builds strip this
 *  metadata, so it's a dev-only nicety; the selector + text always work. */
export function frameworkMetaOf(node: Element): { component?: string; sourceFile?: string } | null {
	const n = node as unknown as Record<string, unknown>;
	// Svelte (dev): __svelte_meta.loc { file, line }
	const sm = (n.__svelte_meta as { loc?: { file: string; line: number } } | undefined)?.loc;
	if (sm?.file) return { sourceFile: `${sm.file}:${sm.line}`, component: baseName(sm.file, /\.svelte$/) };
	// Vue 3 (dev): __vueParentComponent.type { __name | name, __file }
	const vtype = (n.__vueParentComponent as { type?: { __name?: string; name?: string; __file?: string } } | undefined)
		?.type;
	if (vtype && (vtype.__file || vtype.__name || vtype.name)) {
		return {
			sourceFile: vtype.__file,
			component: vtype.__name || vtype.name || (vtype.__file ? baseName(vtype.__file, /\.vue$/) : undefined),
		};
	}
	// React (dev): the fiber stored under a __reactFiber$* / __reactInternalInstance$* key on the DOM node
	const fiberKey = Object.keys(n).find(
		(k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
	);
	if (fiberKey) {
		const sourceFile = reactSource(n[fiberKey]);
		const component = reactComponentName(n[fiberKey]);
		if (sourceFile || component) return { sourceFile, component };
	}
	return null;
}

export function domTargetFromEl(el: Element): DomTarget {
	let node: Element | null = el;
	let sourceFile: string | undefined;
	let component: string | undefined;
	const ancestry: string[] = [];
	while (node && node !== document.body) {
		if (!sourceFile && !component) {
			const meta = frameworkMetaOf(node);
			if (meta) {
				sourceFile = meta.sourceFile;
				component = meta.component;
			}
		}
		ancestry.push(node.tagName.toLowerCase());
		node = node.parentElement;
	}
	return {
		layer: "dom",
		selector: cssPath(el),
		component,
		sourceFile,
		ancestry: ancestry.slice(0, 6),
		text: (el.textContent || "").trim().slice(0, 80) || undefined,
	};
}

/** Single-point resolve: DOM element (or canvas entity) at (cx,cy). */
export function resolveTarget(
	cx: number,
	cy: number,
	canvasEl: HTMLCanvasElement | null,
	adapter: GameAdapter,
): AnnotationTarget | null {
	const prev = canvasEl?.style.pointerEvents ?? "";
	if (canvasEl) canvasEl.style.pointerEvents = "none";
	const el = document.elementFromPoint(cx, cy);
	if (canvasEl) canvasEl.style.pointerEvents = prev;
	if (!el) return null;
	if (el instanceof HTMLCanvasElement) {
		const hit = adapter.hitTestCanvas?.(cx, cy);
		return hit ? { layer: "canvas", ...hit } : null;
	}
	if (el.closest(OWN_CHROME)) return null;
	return domTargetFromEl(el);
}

/** Best-fit resolve for a stroke: samples across the circled region and picks the element whose box
 *  best matches the circle (IoU) — a loose circle resolves the container it encloses, not a leaf. */
export function resolveBest(
	pts: Point[],
	canvasEl: HTMLCanvasElement | null,
	adapter: GameAdapter,
): AnnotationTarget | null {
	if (pts.length === 0) return null;
	const b = bbox(pts);
	const samples: Point[] = [
		{ x: b.x + b.w / 2, y: b.y + b.h / 2 },
		{ x: b.x + b.w * 0.5, y: b.y + b.h * 0.28 },
		{ x: b.x + b.w * 0.5, y: b.y + b.h * 0.72 },
		{ x: b.x + b.w * 0.28, y: b.y + b.h * 0.5 },
		{ x: b.x + b.w * 0.72, y: b.y + b.h * 0.5 },
		pts[0],
		pts[Math.floor(pts.length / 2)],
		pts[pts.length - 1],
	];
	const prev = canvasEl?.style.pointerEvents ?? "";
	if (canvasEl) canvasEl.style.pointerEvents = "none";
	let canvasHit: AnnotationTarget | null = null;
	const seen = new Set<Element>();
	const candidates: Element[] = [];
	for (const p of samples) {
		const el = document.elementFromPoint(p.x, p.y);
		if (!el) continue;
		if (el instanceof HTMLCanvasElement) {
			if (!canvasHit) {
				const hit = adapter.hitTestCanvas?.(p.x, p.y);
				if (hit) canvasHit = { layer: "canvas", ...hit };
			}
			continue;
		}
		if (el.closest(OWN_CHROME)) continue;
		let node: Element | null = el;
		for (let d = 0; node && node !== document.body && d < 8; d++) {
			if (!seen.has(node)) {
				seen.add(node);
				candidates.push(node);
			}
			node = node.parentElement;
		}
	}
	if (canvasEl) canvasEl.style.pointerEvents = prev;
	const circleArea = Math.max(1, b.w * b.h);
	let best: Element | null = null;
	let bestScore = 0;
	for (const el of candidates) {
		const r = el.getBoundingClientRect();
		const ix =
			Math.max(0, Math.min(r.right, b.x + b.w) - Math.max(r.left, b.x)) *
			Math.max(0, Math.min(r.bottom, b.y + b.h) - Math.max(r.top, b.y));
		if (ix <= 0) continue;
		const iou = ix / (Math.max(0, r.width) * Math.max(0, r.height) + circleArea - ix);
		if (iou > bestScore) {
			bestScore = iou;
			best = el;
		}
	}
	return best ? domTargetFromEl(best) : canvasHit;
}

/** Every meaningful DOM element mostly-inside the circle (grid scan), deduped. */
export function resolveEnclosed(
	pts: Point[],
	canvasEl: HTMLCanvasElement | null,
): AnnotationTarget[] {
	if (pts.length === 0) return [];
	const b = bbox(pts);
	const cols = Math.min(8, Math.max(2, Math.round(b.w / 44)));
	const rows = Math.min(8, Math.max(2, Math.round(b.h / 44)));
	const prev = canvasEl?.style.pointerEvents ?? "";
	if (canvasEl) canvasEl.style.pointerEvents = "none";
	const byKey = new Map<string, AnnotationTarget>();
	for (let i = 0; i < cols; i++) {
		for (let j = 0; j < rows; j++) {
			const x = b.x + (b.w * (i + 0.5)) / cols;
			const y = b.y + (b.h * (j + 0.5)) / rows;
			const el = document.elementFromPoint(x, y);
			if (!el || el instanceof HTMLCanvasElement || el.closest(OWN_CHROME)) continue;
			const r = el.getBoundingClientRect();
			const ix =
				Math.max(0, Math.min(r.right, b.x + b.w) - Math.max(r.left, b.x)) *
				Math.max(0, Math.min(r.bottom, b.y + b.h) - Math.max(r.top, b.y));
			if (ix / Math.max(1, r.width * r.height) < 0.4) continue;
			const t = domTargetFromEl(el);
			const key = `${t.sourceFile ?? ""}|${t.selector}`;
			if (!byKey.has(key)) byKey.set(key, t);
		}
	}
	if (canvasEl) canvasEl.style.pointerEvents = prev;
	return [...byKey.values()].slice(0, 12);
}

/** Shortest distance from point p to segment a–b. */
export function distToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Is p within `threshold` px of the polyline `pts`? Used by the erase tool to hit-test a drawn stroke. */
export function nearStroke(p: Point, pts: Point[], threshold = 12): boolean {
	if (pts.length === 0) return false;
	if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= threshold;
	for (let i = 1; i < pts.length; i++) {
		if (distToSegment(p, pts[i - 1], pts[i]) <= threshold) return true;
	}
	return false;
}

/** Photoshop-style sketch eraser: split one stroke by dropping every point within `radius` of the eraser
 *  segment a–b, returning the surviving runs as separate sub-strokes (runs < 2 points are dropped). Pure;
 *  unit-tested. A stroke fully under the eraser returns []; a stroke grazed in the middle returns 2 runs. */
export function splitStrokeBySegment(stroke: Point[], a: Point, b: Point, radius: number): Point[][] {
	const runs: Point[][] = [];
	let run: Point[] = [];
	for (const pt of stroke) {
		if (distToSegment(pt, a, b) <= radius) {
			if (run.length >= 2) runs.push(run);
			run = [];
		} else {
			run.push(pt);
		}
	}
	if (run.length >= 2) runs.push(run);
	return runs;
}

/** Arrow-like = straight + directional (so only real arrows pin a "points-at" target). */
export function isArrowLike(pts: Point[]): boolean {
	if (pts.length < 2) return false;
	const a = pts[0];
	const b = pts[pts.length - 1];
	const chord = Math.hypot(b.x - a.x, b.y - a.y);
	if (chord < 60) return false;
	let len = 0;
	for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
	return len / chord < 1.7;
}
