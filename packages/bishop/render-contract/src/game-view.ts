export interface ViewTransform {
	offsetX: number;
	offsetY: number;
	scale: number;
}

/**
 * Camera framing mode. "follow" is the normal in-game camera (tracks the player by the renderer's
 * own rules). "fit" frames the whole world (ignores the player) — used by an editor to preview a
 * level's full layout/dressing while it's frozen. Renderers that don't implement it stay "follow".
 */
export type CameraMode = "follow" | "fit";

/**
 * A rect in WORLD space (min-corner + size). Field shape matches the game's own rect so the host
 * bridge passes it through by structural typing (no cast).
 */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * The LOGICAL focus a renderer should keep in view: a world-space region (ground-plane rect),
 * projection-agnostic. `center` is the world point at the middle; `worldExtent` is the world-units
 * region to keep visible. The client (game-client) decides this from follow/clamp/zoom policy; the
 * RENDERER turns it into its actual camera — 2D fit, 3D ortho, or 3D perspective (eye/angle/FOV =
 * renderer config) whose view CONTAINS this region. "Camera" the concrete object is renderer-internal.
 */
/**
 * How the renderer reconciles the focus aspect with the actual viewport aspect. The LOGICAL layer
 * chooses this — screen size then only changes what's revealed on the FREE axis, never the focus area:
 * - `"width"`  — lock the focus WIDTH; taller/shorter screens reveal more/less world vertically (default).
 * - `"height"` — lock the focus HEIGHT; wider/narrower screens reveal more/less horizontally.
 * - `"contain"`— keep the WHOLE focus rect visible (letterbox bars on the off-aspect axis).
 * - `"cover"`  — fill the viewport, cropping the focus on the off-aspect axis.
 * Renderers realize scale against the ACTUAL viewport with a UNIFORM factor (no non-uniform stretch).
 */
export type ViewFit = "width" | "height" | "contain" | "cover";

export interface ViewFocus {
	center: { x: number; y: number };
	worldExtent: { w: number; h: number };
	/** Aspect-reconciliation policy (default `"width"`). */
	fit?: ViewFit;
}

/** The world rect a focus frames (`center ± worldExtent/2`) — used to drive interest/culling. */
export function viewFocusRect(f: ViewFocus): Rect {
	return {
		x: f.center.x - f.worldExtent.w / 2,
		y: f.center.y - f.worldExtent.h / 2,
		w: f.worldExtent.w,
		h: f.worldExtent.h,
	};
}

/**
 * The renderer contract every game-view implements. `TState` is the game's world-state snapshot,
 * treated as opaque here — the engine defines the drive protocol; the game binds a concrete state
 * type. This package has ZERO game dependency by design.
 */
export interface IGameView<TState> {
	init(canvas: HTMLCanvasElement): void;
	render(state: TState, dt: number): void;
	resize(width: number, height: number): void;
	destroy(): void;
	setVolume?(volume: number): void;
	/**
	 * Set the LOGICAL view focus for this frame (from the game-client). The renderer realizes it as its
	 * own camera (2D fit / 3D projection). When provided, this replaces any renderer-owned camera policy.
	 */
	setViewFocus?(focus: ViewFocus | null): void;
	/**
	 * The camera's screen↔world transform (scale + translate), or null when the renderer exposes no
	 * usable world transform (camera not ready, or a renderer that doesn't map screen to world). This
	 * is the single camera primitive: the visible world rect (area-of-interest) is derived from it via
	 * {@link worldRectFromTransform}; screen→world picking inverts it as `(s - offset) / scale`.
	 */
	getViewTransform?(): ViewTransform | null;
}

/**
 * The visible world rect a camera transform maps a `screenW × screenH` viewport onto — the screen box
 * `(0,0)–(screenW,screenH)` un-projected through `vt` (`world = (screen - offset) / scale`). This is
 * the inverse of the transform over the viewport; there is no independent "interest rect" to expose.
 */
export function worldRectFromTransform(vt: ViewTransform, screenW: number, screenH: number): Rect {
	return {
		x: -vt.offsetX / vt.scale,
		y: -vt.offsetY / vt.scale,
		w: screenW / vt.scale,
		h: screenH / vt.scale,
	};
}
