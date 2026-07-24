// Marksman — generic, game-agnostic types. The GameAdapter is the ONLY game-specific surface; a host
// implements it for its game/stack. See ../../ARCHITECTURE.md (the porting contract).

export interface Point {
	x: number;
	y: number;
}

export interface Bbox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** What a canvas-layer hit-test resolves to. Durable identity = entityType + configPath (the eid is
 *  recycled across runs, so it's a same-session hint only). */
export interface CanvasHit {
	entityId: number;
	entityType: number;
	configPath: string;
	worldPoint: Point;
}

export interface DomTarget {
	layer: "dom";
	selector: string;
	component?: string;
	sourceFile?: string;
	ancestry?: string[];
	screenLabel?: string;
	text?: string;
}

export type CanvasTarget = { layer: "canvas" } & CanvasHit;
export type AnnotationTarget = DomTarget | CanvasTarget;

/** Task type, set per Note (defaulted from its target: DOM→ui, canvas→gameplay). Drives how the task is
 *  processed — only "ui" gets the UI-craft persona. On Send, Notes group by domain → one task
 *  per domain (auto-split when a screen's marks span types). */
export type TaskDomain = "ui" | "gameplay" | "design" | "bug";

/** A typed text label placed on the screen (the "write text" tool — sketch, but typing). */
export interface TextLabel {
	x: number;
	y: number;
	text: string;
}

/** The unit of markup: one red circle + its comment + the cyan sketches / typed text that illustrate it.
 *  A note that started from a sketch or text has `circle: null`. Notes group by domain on Send → one task
 *  per domain, each with a clean screenshot showing only ITS marks. */
export interface Note {
	id: string;
	domain: TaskDomain;
	comment: string;
	circle: Point[] | null;
	sketches: Point[][];
	texts: TextLabel[];
	target?: AnnotationTarget | null;
	/** Every meaningful element inside the circle (grid-scanned) — so a circle around several things
	 *  ("one of these 5 is missing X") gives the AI the whole set to reason over, not just the best-fit one.
	 *  `target` is still the primary/best-fit; `enclosed` is the full list (deduped). */
	enclosed?: AnnotationTarget[];
	/** Resolved element each sketch's END point (arrow tip) points at — so "move it to where the arrow
	 *  points" is pinned, not inferred. One entry per sketch, aligned by index; null if it points at nothing. */
	sketchTargets?: (AnnotationTarget | null)[];
}

/** The only game-specific surface. setPaused is required (Phase 1); capture/hit-test/emit land in
 *  Phases 2–3 and are optional so the shell runs without them. */
export interface GameAdapter {
	setPaused(paused: boolean): void;
	/** Phase 2 — composite screenshot (pixi world + DOM HUD + overlay). */
	captureFrame?(): Promise<Blob>;
	/** Phase 2 — pixel → entity identity via getViewTransform() + state.entities. */
	hitTestCanvas?(screenX: number, screenY: number): CanvasHit | null;
	/** Phase 3 — where the emitted task + assets are written (resolved by the host endpoint). */
	emitTarget?: { inboxDir: string; assetsDir: string };
}
