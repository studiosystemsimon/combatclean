import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { loadConfig, sendTask, sendTranscript } from "./emit";
import {
	bbox,
	isArrowLike,
	nearStroke,
	resolveBest,
	resolveEnclosed,
	resolveTarget,
	splitStrokeBySegment,
} from "./resolve";
import { VoiceController, appendTranscript, type VoiceStatus } from "./internal/voice-controller";
import type { AnnotationTarget, GameAdapter, Note, Point, TaskDomain, TextLabel } from "./types";

const COLORS = { red: "#ff3b30", cyan: "#00e5ff" } as const;
const TEXT_SIZE = 16;
const TEXT_FONT = `bold ${TEXT_SIZE}px ui-sans-serif, system-ui, sans-serif`;
const ERASE_R = 14; // sketch-eraser radius

type RecTarget = "session" | "comment" | "text";
type Op = { apply: () => void; revert: () => void };

const REC_LABEL: Record<VoiceStatus, string> = {
	off: "🎙 Voice",
	listening: "● listening",
	hearing: "● hearing…",
	transcribing: "● transcribing…",
};

const uid = () => crypto.randomUUID();

// Domain is no longer user-chosen (no dropdown) — it's inferred from what was marked so the later
// processing step still gets a routing hint. Longer term it'll be inferred from the raw transcript/comment.
function inferDomain(t: AnnotationTarget | null | undefined): TaskDomain {
	if (t?.layer === "canvas") return "gameplay";
	if (t?.layer === "dom") return "ui";
	return "bug"; // unresolved target (circled empty space) ≈ "something's wrong here" → bug, not design
}

/** A clean task title from a comment: first sentence (if short) else word-boundary truncate. */
function cleanTitle(s: string): string {
	const oneLine = s.trim().replace(/\s+/g, " ");
	const m = oneLine.match(/^.*?[.!?](\s|$)/);
	let base = m && m[0].trim().length <= 70 ? m[0].trim() : oneLine;
	base = base.replace(/[.!?]+$/, "");
	if (base.length <= 64) return base;
	const cut = base.slice(0, 64);
	const sp = cut.lastIndexOf(" ");
	return `${(sp > 24 ? cut.slice(0, sp) : cut).trim()}…`;
}

function loadBool(k: string, d: boolean): boolean {
	try {
		const v = localStorage.getItem(k);
		return v === null ? d : v === "1";
	} catch {
		return d;
	}
}

function clampPos(x: number, y: number) {
	return {
		x: Math.max(8, Math.min(x, window.innerWidth - 300)),
		y: Math.max(56, Math.min(y, window.innerHeight - 220)),
	};
}

function noteAnchor(n: Note): Point {
	if (n.circle?.length) return n.circle[n.circle.length - 1];
	if (n.sketches[0]?.length) return n.sketches[0][0];
	if (n.texts[0]) return n.texts[0];
	return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function bboxCenter(pts: Point[]): Point {
	const b = bbox(pts);
	return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Pointer capture is best-effort — it throws if the pointer isn't active (e.g. synthetic events). */
function capturePointer(el: HTMLElement | null, pointerId: number) {
	try {
		el?.setPointerCapture(pointerId);
	} catch {
		/* ignore — capture is a nicety, drawing still works without it */
	}
}

// ── canvas rendering (plain Canvas 2D — framework-agnostic) ─────────────────────
function strokePath(ctx: CanvasRenderingContext2D, pts: Point[], color: string) {
	if (pts.length === 0) return;
	ctx.strokeStyle = color;
	ctx.lineWidth = 3;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
	ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
	ctx.font = TEXT_FONT;
	ctx.textBaseline = "top";
	ctx.lineJoin = "round";
	ctx.lineWidth = 4;
	ctx.strokeStyle = "rgba(0,0,0,0.85)"; // dark outline so white reads on any background
	ctx.fillStyle = "#ffffff";
	ctx.strokeText(text, x, y);
	ctx.fillText(text, x, y);
}

function paintNote(ctx: CanvasRenderingContext2D, n: Note) {
	if (n.circle) strokePath(ctx, n.circle, COLORS.red);
	for (const s of n.sketches) strokePath(ctx, s, COLORS.cyan);
	for (const t of n.texts) drawText(ctx, t.x, t.y, t.text);
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
	return new Promise((res, rej) => {
		const img = new Image();
		img.onload = () => res(img);
		img.onerror = rej;
		img.src = URL.createObjectURL(blob);
	});
}

// The overlay's own CSS — injected once into <head> (was a Svelte scoped <style>; every rule is
// already `.mk-`-prefixed, so it's safe as a global stylesheet).
let _stylesInjected = false;
function injectStyles() {
	if (_stylesInjected || typeof document === "undefined") return;
	_stylesInjected = true;
	const el = document.createElement("style");
	el.setAttribute("data-marksman", "");
	el.textContent = MARKSMAN_CSS;
	document.head.appendChild(el);
}

export default function Marksman({ adapter }: { adapter: GameAdapter }) {
	injectStyles();

	// Passive by default: NO tool armed on open, so the overlay never intercepts clicks (or draws stray
	// marks) until the user explicitly picks a tool. "none" ⇒ the canvas is click-through (see mk-passthrough).
	const [open, setOpen] = useState(false);
	const [tool, setTool] = useState<"none" | "red" | "cyan" | "text" | "erase">("none");
	const [sketchErase, setSketchErase] = useState(false); // cyan sub-mode: drag to erase from the sketch
	const [notes, setNotes] = useState<Note[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	// Voice — the optional AUDIO feature. Two surfaces: the 🎙 Voice toolbar button is a passive session
	// transcript recorder; the per-field 🎙 buttons dictate into a note comment / text label. Gated on
	// features.audio; whisper runs server-side. recEnabled/recVocab are hydrated from marksman.config.json.
	const [recEnabled, setRecEnabled] = useState(false);
	const recVocabRef = useRef("");
	const [recording, setRecording] = useState(false);
	const [recStatus, setRecStatus] = useState<VoiceStatus>("off");
	const [recTarget, setRecTarget] = useState<RecTarget | null>(null);
	const [recTranscript, setRecTranscript] = useState("");
	const voiceRef = useRef<VoiceController | null>(null);

	// settings (persisted) — shown via the bar cogwheel
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [pauseOnOpen, setPauseOnOpen] = useState(() => loadBool("marksman.pauseOnOpen", true));

	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const dprRef = useRef(1);
	const drawingRef = useRef(false);
	const currentRef = useRef<Point[]>([]);
	const sketchErasingRef = useRef(false);
	const lastEraseRef = useRef<Point>({ x: 0, y: 0 });
	const eraseDragBeforeRef = useRef<Note[]>([]);
	const draggingTextRef = useRef<{ noteId: string; index: number; dx: number; dy: number } | null>(null);

	// Undo/redo + erase apply ONLY to drawn things (sketches + text labels), never the red circle (a circle
	// IS a note/task — delete it via the notes panel). Stacks live in refs; lengths mirror to state so the
	// toolbar's disabled state re-renders.
	const undoStackRef = useRef<Op[]>([]);
	const redoStackRef = useRef<Op[]>([]);
	const [undoLen, setUndoLen] = useState(0);
	const [redoLen, setRedoLen] = useState(0);

	const [barPos, setBarPos] = useState({ x: 12, y: 12 });
	const barMovedRef = useRef(false);
	const [editorPos, setEditorPos] = useState({ x: 24, y: 64 });
	const [showNotes, setShowNotes] = useState(false);
	const [showSend, setShowSend] = useState(false);
	const [sendTitle, setSendTitle] = useState("");
	const [sending, setSending] = useState(false);
	const [textPlacing, setTextPlacing] = useState<{ x: number; y: number } | null>(null);
	const [textValue, setTextValue] = useState("");
	const [editingText, setEditingText] = useState<{ noteId: string; index: number } | null>(null);

	const activeNote = notes.find((n) => n.id === activeId) ?? null;

	// Live-latest mirrors for closures that outlive a render (window listeners, the voice sink).
	const activeIdRef = useRef<string | null>(activeId);
	activeIdRef.current = activeId;

	// ── history ────────────────────────────────────────────────────────────────
	function syncHist() {
		setUndoLen(undoStackRef.current.length);
		setRedoLen(redoStackRef.current.length);
	}
	function pushOp(op: Op) {
		op.apply();
		undoStackRef.current.push(op);
		redoStackRef.current = [];
		syncHist();
	}
	function undo() {
		if (drawingRef.current) return; // not mid-stroke — the in-progress draw would land on the wrong state
		const op = undoStackRef.current.pop();
		if (!op) return;
		op.revert();
		redoStackRef.current.push(op);
		syncHist();
	}
	function redo() {
		if (drawingRef.current) return;
		const op = redoStackRef.current.pop();
		if (!op) return;
		op.apply();
		undoStackRef.current.push(op);
		syncHist();
	}
	function recordOp(op: Op) {
		// record the inverse of a change ALREADY applied live (a sketch-eraser drag) — don't re-apply.
		undoStackRef.current.push(op);
		redoStackRef.current = [];
		syncHist();
	}
	function resetHistory() {
		undoStackRef.current = [];
		redoStackRef.current = [];
		syncHist();
	}

	// ── rendering ────────────────────────────────────────────────────────────────
	function redraw() {
		const el = canvasRef.current;
		if (!el) return;
		const ctx = el.getContext("2d");
		if (!ctx) return;
		const dpr = dprRef.current;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		for (const n of notes) {
			ctx.globalAlpha = activeId == null || n.id === activeId ? 1 : 0.28;
			paintNote(ctx, n);
		}
		ctx.globalAlpha = 1;
		if (drawingRef.current && currentRef.current.length)
			strokePath(ctx, currentRef.current, COLORS[tool === "cyan" ? "cyan" : "red"]);
	}

	function sizeCanvas() {
		requestAnimationFrame(() => {
			const el = canvasRef.current;
			if (!el) return;
			dprRef.current = window.devicePixelRatio || 1;
			el.width = Math.round(window.innerWidth * dprRef.current);
			el.height = Math.round(window.innerHeight * dprRef.current);
			redraw();
		});
	}

	// Repaint committed state whenever it changes; size the canvas whenever the overlay opens. In-progress
	// strokes (refs, no state) call redraw() directly from the pointer handlers.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => {
		redraw();
	}, [notes, activeId, tool, open]);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => {
		if (open) sizeCanvas();
	}, [open]);

	function toggle() {
		const next = !open;
		setOpen(next);
		adapter.setPaused(next && pauseOnOpen);
		if (next) {
			if (!barMovedRef.current) setBarPos({ x: Math.max(8, (window.innerWidth - 680) / 2), y: 12 });
		} else {
			stopRec();
			setActiveId(null);
			setShowSend(false);
			setTextPlacing(null);
		}
	}

	function togglePauseOnOpen(v: boolean) {
		setPauseOnOpen(v);
		try {
			localStorage.setItem("marksman.pauseOnOpen", v ? "1" : "0");
		} catch {
			/* ignore */
		}
		if (open) adapter.setPaused(open && v); // apply immediately if already open
	}

	// ── note ops ─────────────────────────────────────────────────────────────────
	function updateActive(fn: (n: Note) => Note) {
		setNotes((prev) => prev.map((n) => (n.id === activeIdRef.current ? fn(n) : n)));
	}
	function updateNote(id: string, fn: (n: Note) => Note) {
		setNotes((prev) => prev.map((n) => (n.id === id ? fn(n) : n)));
	}
	function selectNote(id: string) {
		setActiveId(id);
		const n = notes.find((x) => x.id === id);
		if (n) {
			const a = noteAnchor(n);
			setEditorPos(clampPos(a.x, a.y + 8));
		}
	}
	function deleteNote(id: string) {
		setNotes((prev) => prev.filter((n) => n.id !== id));
		if (activeId === id) setActiveId(null);
		resetHistory(); // ops may reference this note; drop them rather than risk a stale undo/redo
	}
	function clearAll() {
		setNotes([]);
		setActiveId(null);
		resetHistory();
	}

	// ── voice recorder (audio feature) ────────────────────────────────────────────
	function flashToast(msg: string, ms = 5000) {
		setToast(msg);
		setTimeout(() => setToast(null), ms);
	}
	/** Open the mic and stream each utterance into `sink`. Switches target if one is already recording. */
	async function startRec(target: RecTarget, sink: (text: string) => void) {
		if (voiceRef.current) stopRec();
		// Confirm the backend has a model BEFORE opening the mic, so we guide setup instead of failing
		// silently mid-utterance.
		try {
			const res = await fetch("/__marksman/recording/status");
			const st = (await res.json()) as { available?: boolean; reason?: string };
			if (!st.available) {
				flashToast(
					`Voice unavailable: ${st.reason ?? "whisper not set up"} — check recording.whisperDir in marksman.config.json`,
					6000,
				);
				return;
			}
		} catch {
			flashToast("Voice endpoint not reachable (dev server only)");
			return;
		}
		setRecTarget(target);
		const controller = new VoiceController(
			{
				onStatus: (s) => setRecStatus(s),
				onTranscript: (text) => sink(text),
				onError: (m) => flashToast(`Voice: ${m}`),
			},
			{ vocabularyPrompt: recVocabRef.current },
		);
		voiceRef.current = controller;
		try {
			await controller.start();
			setRecording(true);
		} catch (e) {
			voiceRef.current = null;
			setRecTarget(null);
			flashToast(`Mic error: ${e}`);
		}
	}
	function stopRec() {
		if (voiceRef.current) {
			voiceRef.current.stop();
			voiceRef.current = null;
		}
		setRecording(false);
		setRecStatus("off");
		setRecTarget(null);
	}
	/** The general playtest recorder (its own transcript panel + task). */
	function toggleSessionRec() {
		if (recording && recTarget === "session") stopRec();
		else void startRec("session", (t) => setRecTranscript((prev) => appendTranscript(prev, t)));
	}
	/** Dictate into the active note's comment box. */
	function toggleCommentRec() {
		if (recording && recTarget === "comment") stopRec();
		else void startRec("comment", (t) => updateActive((n) => ({ ...n, comment: appendTranscript(n.comment, t) })));
	}
	/** Dictate into the on-screen text-label box. */
	function toggleTextRec() {
		if (recording && recTarget === "text") stopRec();
		else void startRec("text", (t) => setTextValue((prev) => appendTranscript(prev, t)));
	}
	async function submitTranscript() {
		const text = recTranscript.trim();
		if (!text || sending) return;
		stopRec();
		setSending(true);
		try {
			await sendTranscript({ transcript: text });
			setToast("Sent transcript → inbox");
			setRecTranscript("");
			setTimeout(() => setToast(null), 4000);
		} catch (e) {
			setToast(`Failed: ${e}`);
			setTimeout(() => setToast(null), 5000);
		} finally {
			setSending(false);
		}
	}
	function discardTranscript() {
		stopRec();
		setRecTranscript("");
	}

	// ── drawing handlers ───────────────────────────────────────────────────────────
	/** Is (x,y) over an existing text label of the ACTIVE note? (text-mode drag-to-move). */
	function textHitTest(x: number, y: number): { noteId: string; index: number } | null {
		const n = activeNote;
		const ctx = canvasRef.current?.getContext("2d");
		if (!n || !ctx) return null;
		ctx.font = TEXT_FONT;
		const h = TEXT_SIZE * 1.3;
		for (let i = n.texts.length - 1; i >= 0; i--) {
			const t = n.texts[i];
			const w = ctx.measureText(t.text).width;
			if (x >= t.x && x <= t.x + w && y >= t.y && y <= t.y + h) return { noteId: n.id, index: i };
		}
		return null;
	}
	/** Hit-test a text label across ALL notes (double-click-to-edit). */
	function textHitAny(x: number, y: number): { noteId: string; index: number } | null {
		const ctx = canvasRef.current?.getContext("2d");
		if (!ctx) return null;
		ctx.font = TEXT_FONT;
		const h = TEXT_SIZE * 1.3;
		for (let ni = notes.length - 1; ni >= 0; ni--) {
			const n = notes[ni];
			for (let ti = n.texts.length - 1; ti >= 0; ti--) {
				const t = n.texts[ti];
				const w = ctx.measureText(t.text).width;
				if (x >= t.x && x <= t.x + w && y >= t.y && y <= t.y + h) return { noteId: n.id, index: ti };
			}
		}
		return null;
	}
	/** Double-click an existing text label to re-open it for editing (prefilled). */
	function onDblClick(e: ReactMouseEvent<HTMLCanvasElement>) {
		if (showSend || tool === "erase" || (tool === "cyan" && sketchErase)) return;
		const hit = textHitAny(e.clientX, e.clientY);
		if (!hit) return;
		const label = notes.find((n) => n.id === hit.noteId)?.texts[hit.index];
		if (!label) return;
		setActiveId(hit.noteId);
		setEditingText(hit);
		setTextValue(label.text);
		setTextPlacing({ x: label.x, y: label.y });
	}

	/** Drag-erase from the cyan sketch (Photoshop-style): drop sketch points within ERASE_R of the eraser
	 *  segment a–b, splitting strokes. Sketch content only — red circles + text are untouched. */
	function eraseSketchAlong(a: Point, b: Point) {
		setNotes((prev) =>
			prev.map((n) =>
				n.sketches.length ? { ...n, sketches: n.sketches.flatMap((s) => splitStrokeBySegment(s, a, b, ERASE_R)) } : n,
			),
		);
	}
	function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
		if (showSend || tool === "none") return; // passive: no tool armed ⇒ ignore (canvas is also click-through)
		if (tool === "cyan" && sketchErase) {
			eraseDragBeforeRef.current = notes;
			lastEraseRef.current = { x: e.clientX, y: e.clientY };
			sketchErasingRef.current = true;
			eraseSketchAlong(lastEraseRef.current, lastEraseRef.current);
			capturePointer(canvasRef.current, e.pointerId);
			return;
		}
		if (tool === "text") {
			// drag an existing text of the active note if you grabbed one; else drop a new one
			const hit = textHitTest(e.clientX, e.clientY);
			if (hit && activeNote) {
				const t = activeNote.texts[hit.index];
				draggingTextRef.current = { noteId: hit.noteId, index: hit.index, dx: e.clientX - t.x, dy: e.clientY - t.y };
				capturePointer(canvasRef.current, e.pointerId);
				return;
			}
			setTextValue("");
			setTextPlacing(clampPos(e.clientX, e.clientY));
			return;
		}
		if (tool === "erase") {
			eraseAt(e.clientX, e.clientY);
			return;
		}
		drawingRef.current = true;
		currentRef.current = [{ x: e.clientX, y: e.clientY }];
		capturePointer(canvasRef.current, e.pointerId);
	}
	function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
		if (sketchErasingRef.current) {
			const cur = { x: e.clientX, y: e.clientY };
			eraseSketchAlong(lastEraseRef.current, cur);
			lastEraseRef.current = cur;
			return;
		}
		if (draggingTextRef.current) {
			const { noteId, index, dx, dy } = draggingTextRef.current;
			const nx = e.clientX - dx;
			const ny = e.clientY - dy;
			setNotes((prev) =>
				prev.map((n) =>
					n.id === noteId ? { ...n, texts: n.texts.map((t, i) => (i === index ? { ...t, x: nx, y: ny } : t)) } : n,
				),
			);
			return;
		}
		if (!drawingRef.current) return;
		currentRef.current.push({ x: e.clientX, y: e.clientY });
		redraw();
	}
	function onPointerUp() {
		if (sketchErasingRef.current) {
			sketchErasingRef.current = false;
			const before = eraseDragBeforeRef.current;
			// Capture the current (post-erase) notes for the redo half of this one-drag op.
			setNotes((after) => {
				recordOp({
					apply: () => setNotes(after),
					revert: () => setNotes(before),
				});
				return after;
			});
			return;
		}
		if (draggingTextRef.current) {
			draggingTextRef.current = null;
			return;
		}
		if (!drawingRef.current) return;
		drawingRef.current = false;
		const pts = currentRef.current;
		currentRef.current = [];
		if (pts.length < 2) {
			redraw();
			return;
		}
		if (tool === "cyan") {
			addSketch(pts);
		} else {
			const target = resolveBest(pts, canvasRef.current, adapter);
			const enclosed = resolveEnclosed(pts, canvasRef.current);
			const id = uid();
			setNotes((prev) => [
				...prev,
				{ id, domain: inferDomain(target), comment: "", circle: pts, sketches: [], texts: [], target, enclosed },
			]);
			setActiveId(id);
			setEditorPos(clampPos(pts[pts.length - 1].x, pts[pts.length - 1].y + 8));
		}
	}

	/** Add a cyan sketch — into the active note, or a new sketch-first note. Undoable. */
	function addSketch(pts: Point[]) {
		if (activeNote) {
			const id = activeId as string;
			pushOp({
				apply: () => updateNote(id, (n) => ({ ...n, sketches: [...n.sketches, pts] })),
				revert: () => updateNote(id, (n) => ({ ...n, sketches: n.sketches.filter((s) => s !== pts) })),
			});
		} else {
			const at = bboxCenter(pts);
			const target = resolveTarget(at.x, at.y, canvasRef.current, adapter);
			const note: Note = { id: uid(), domain: inferDomain(target), comment: "", target, circle: null, sketches: [pts], texts: [] };
			const pos = clampPos(at.x, at.y + 8);
			pushOp({
				apply: () => {
					setNotes((prev) => [...prev, note]);
					setActiveId(note.id);
					setEditorPos(pos);
				},
				revert: () => {
					setNotes((prev) => prev.filter((n) => n.id !== note.id));
					setActiveId((cur) => (cur === note.id ? null : cur));
				},
			});
		}
	}

	/** Erase tool: remove the topmost sketch/text under (x,y) across all notes; never a red circle. */
	function eraseAt(x: number, y: number) {
		const ctx = canvasRef.current?.getContext("2d");
		for (let ni = notes.length - 1; ni >= 0; ni--) {
			const n = notes[ni];
			if (ctx) {
				ctx.font = TEXT_FONT;
				const h = TEXT_SIZE * 1.3;
				for (let ti = n.texts.length - 1; ti >= 0; ti--) {
					const t = n.texts[ti];
					const w = ctx.measureText(t.text).width;
					if (x >= t.x && x <= t.x + w && y >= t.y && y <= t.y + h) return eraseItem(n, "text", ti, t);
				}
			}
			for (let si = n.sketches.length - 1; si >= 0; si--) {
				if (nearStroke({ x, y }, n.sketches[si], 12)) return eraseItem(n, "sketch", si, n.sketches[si]);
			}
		}
	}
	function eraseItem(note: Note, kind: "sketch" | "text", index: number, value: Point[] | TextLabel) {
		const emptiesNote = !note.circle && note.sketches.length + note.texts.length === 1;
		pushOp({
			apply: () => {
				if (emptiesNote) {
					setNotes((prev) => prev.filter((n) => n.id !== note.id));
					setActiveId((cur) => (cur === note.id ? null : cur));
				} else if (kind === "sketch") {
					updateNote(note.id, (n) => ({ ...n, sketches: n.sketches.filter((_, i) => i !== index) }));
				} else {
					updateNote(note.id, (n) => ({ ...n, texts: n.texts.filter((_, i) => i !== index) }));
				}
			},
			revert: () => {
				if (emptiesNote) {
					setNotes((prev) => [...prev, note]);
				} else if (kind === "sketch") {
					updateNote(note.id, (n) => ({
						...n,
						sketches: [...n.sketches.slice(0, index), value as Point[], ...n.sketches.slice(index)],
					}));
				} else {
					updateNote(note.id, (n) => ({
						...n,
						texts: [...n.texts.slice(0, index), value as TextLabel, ...n.texts.slice(index)],
					}));
				}
			},
		});
	}

	function commitText() {
		const t = textValue.trim();
		const p = textPlacing;
		const editing = editingText;
		setTextPlacing(null);
		setEditingText(null);
		if (!p) return;
		if (editing) {
			const { noteId, index } = editing;
			const oldLabel = notes.find((n) => n.id === noteId)?.texts[index];
			if (!oldLabel) return;
			if (!t) {
				pushOp({
					apply: () => updateNote(noteId, (n) => ({ ...n, texts: n.texts.filter((_, i) => i !== index) })),
					revert: () =>
						updateNote(noteId, (n) => ({ ...n, texts: [...n.texts.slice(0, index), oldLabel, ...n.texts.slice(index)] })),
				});
			} else {
				const newLabel: TextLabel = { x: oldLabel.x, y: oldLabel.y, text: t };
				pushOp({
					apply: () => updateNote(noteId, (n) => ({ ...n, texts: n.texts.map((x, i) => (i === index ? newLabel : x)) })),
					revert: () => updateNote(noteId, (n) => ({ ...n, texts: n.texts.map((x, i) => (i === index ? oldLabel : x)) })),
				});
			}
			return;
		}
		if (!t) return;
		if (activeNote) {
			const id = activeId as string;
			const label: TextLabel = { x: p.x, y: p.y, text: t };
			pushOp({
				apply: () => updateNote(id, (n) => ({ ...n, texts: [...n.texts, label] })),
				revert: () => updateNote(id, (n) => ({ ...n, texts: n.texts.filter((x) => x !== label) })),
			});
		} else {
			const target = resolveTarget(p.x, p.y, canvasRef.current, adapter);
			const note: Note = { id: uid(), domain: inferDomain(target), comment: "", target, circle: null, sketches: [], texts: [{ x: p.x, y: p.y, text: t }] };
			const pos = clampPos(p.x, p.y + 8);
			pushOp({
				apply: () => {
					setNotes((prev) => [...prev, note]);
					setActiveId(note.id);
					setEditorPos(pos);
				},
				revert: () => {
					setNotes((prev) => prev.filter((n) => n.id !== note.id));
					setActiveId((cur) => (cur === note.id ? null : cur));
				},
			});
		}
	}

	// ── screenshot + send ───────────────────────────────────────────────────────────
	/** Resolve what each arrow-like sketch's tip points at (for "move it to where the arrow points"). */
	function enrichSketchTargets(n: Note): Note {
		if (!n.sketches.length) return n;
		return {
			...n,
			sketchTargets: n.sketches.map((s) =>
				isArrowLike(s) ? resolveTarget(s[s.length - 1].x, s[s.length - 1].y, canvasRef.current, adapter) : null,
			),
		};
	}

	/** Clean per-task screenshot: live frame + ONLY this group's marks (full opacity). */
	async function composeScreenshot(group: Note[]): Promise<Blob> {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const out = document.createElement("canvas");
		out.width = vw;
		out.height = vh;
		const ctx = out.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		if (adapter.captureFrame) {
			ctx.drawImage(await blobToImage(await adapter.captureFrame()), 0, 0, vw, vh);
		}
		ctx.globalAlpha = 1;
		for (const n of group) paintNote(ctx, n);
		return await new Promise<Blob>((res, rej) =>
			out.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
		);
	}

	function deriveScreen(group: Note[]): string {
		const dom = group.find((n) => n.target?.layer === "dom");
		return (dom?.target as { component?: string } | undefined)?.component || "game";
	}

	async function doSend() {
		if (sending || notes.length === 0) return;
		setSending(true);
		try {
			// One Send → one raw capture. Domain is still inferred (from the first resolved mark) so the
			// sidecar bundle keeps a routing hint for the later processing step; the user no longer picks it.
			const domain = notes.find((n) => n.target)?.domain ?? notes[0].domain;
			const screenshot = await composeScreenshot(notes);
			const title = sendTitle.trim() || cleanTitle(notes[0].comment || "markup");
			await sendTask({
				title,
				screen: deriveScreen(notes),
				domain,
				notes: notes.map(enrichSketchTargets),
				screenshot,
			});
			setToast("Sent → inbox");
			setNotes([]);
			setActiveId(null);
			setSendTitle("");
			setShowSend(false);
			resetHistory();
			setTimeout(() => setToast(null), 4000);
		} catch (e) {
			setToast(`Failed: ${e}`);
			setTimeout(() => setToast(null), 5000);
		} finally {
			setSending(false);
		}
	}

	// ── drag ─────────────────────────────────────────────────────────────────────
	function startDrag(
		e: ReactPointerEvent,
		get: () => { x: number; y: number },
		set: (p: { x: number; y: number }) => void,
	) {
		e.preventDefault();
		const sx = e.clientX;
		const sy = e.clientY;
		const o = get();
		const move = (ev: PointerEvent) => set({ x: o.x + (ev.clientX - sx), y: o.y + (ev.clientY - sy) });
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT");
		if (e.key === "`" && !typing) {
			e.preventDefault();
			toggle();
		} else if (open && !typing && (e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
		} else if (open && !typing && (e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
			e.preventDefault();
			redo();
		} else if (open && e.key === "Escape") {
			if (textPlacing) setTextPlacing(null);
			else if (showSend) setShowSend(false);
			else if (activeId) setActiveId(null);
			else toggle();
		}
	}

	/** Defer one frame: focusing synchronously on mount lets the placing click immediately blur the input
	 *  (→ onblur commits empty → it vanishes before you can type). rAF focuses after that settles. */
	function autofocus(node: HTMLElement | null) {
		if (node) requestAnimationFrame(() => node.focus());
	}

	// Latest-value mirrors so the one-shot window listeners (below) don't capture stale closures.
	const onKeyRef = useRef(onKey);
	onKeyRef.current = onKey;
	const sizeCanvasRef = useRef(sizeCanvas);
	sizeCanvasRef.current = sizeCanvas;
	const stopRecRef = useRef(stopRec);
	stopRecRef.current = stopRec;

	useEffect(() => {
		const key = (e: KeyboardEvent) => onKeyRef.current(e);
		const rez = () => sizeCanvasRef.current();
		window.addEventListener("keydown", key);
		window.addEventListener("resize", rez);
		// Hydrate voice-dictation gating from marksman.config.json (cached; tool-generic defaults if absent).
		loadConfig()
			.then((c) => {
				setRecEnabled(c.recording.enabled);
				recVocabRef.current = c.recording.vocabularyPrompt;
			})
			.catch(() => {});
		return () => {
			window.removeEventListener("keydown", key);
			window.removeEventListener("resize", rez);
			stopRecRef.current(); // release the mic if the overlay unmounts mid-recording
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (!open) {
		return (
			<>
				<button className="mk-fab" onClick={toggle} title="Open Marksman (`)">
					◎
				</button>
				{toast && <div className="mk-toast">{toast}</div>}
			</>
		);
	}

	return (
		<>
			<canvas
				ref={canvasRef}
				className={`mk-canvas${tool === "none" ? " mk-passthrough" : ""}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onDoubleClick={onDblClick}
			/>

			<div className="mk-bar" style={{ left: barPos.x, top: barPos.y }}>
				<span
					className="mk-grip"
					title="Drag"
					onPointerDown={(e) => {
						barMovedRef.current = true;
						startDrag(e, () => barPos, setBarPos);
					}}
				/>
				<span className="mk-title">Marksman</span>
				<button
					className={`mk-tool${tool === "red" ? " active" : ""}`}
					style={{ ["--c"]: COLORS.red } as CSSProperties}
					onClick={() => setTool("red")}
				>
					● Mark
				</button>
				<button
					className={`mk-tool${tool === "cyan" ? " active" : ""}`}
					style={{ ["--c"]: tool === "cyan" && sketchErase ? "#ff9f0a" : COLORS.cyan } as CSSProperties}
					title="Sketch (cyan). Click again while active to toggle a drag-to-erase eraser ON the sketch."
					onClick={() => {
						if (tool === "cyan") setSketchErase((v) => !v);
						else {
							setTool("cyan");
							setSketchErase(false);
						}
					}}
				>
					{tool === "cyan" && sketchErase ? "⌫ Erase sketch" : "✎ Sketch"}
				</button>
				<button
					className={`mk-tool${tool === "text" ? " active" : ""}`}
					style={{ ["--c"]: "#ffffff" } as CSSProperties}
					onClick={() => setTool("text")}
				>
					T Text
				</button>
				<button
					className={`mk-tool${tool === "erase" ? " active" : ""}`}
					style={{ ["--c"]: "#ff9f0a" } as CSSProperties}
					title="Erase a sketch or text label (click it). For the red circle, delete the note instead."
					onClick={() => setTool("erase")}
				>
					⌫ Erase
				</button>
				{recEnabled && (
					<button
						className={`mk-tool${recording && recTarget === "session" ? " active" : ""}`}
						style={{ ["--c"]: recording && recTarget === "session" ? COLORS.red : "#ffffff" } as CSSProperties}
						title={
							recording && recTarget === "session"
								? "Stop the transcript recorder"
								: "Record a spoken transcript (playtesting / general notes)"
						}
						onClick={toggleSessionRec}
					>
						{recording && recTarget === "session" ? REC_LABEL[recStatus] : "🎙 Voice"}
					</button>
				)}
				<span className="mk-spacer" />
				<button className="mk-btn" onClick={undo} disabled={undoLen === 0} title="Undo a drawn thing (Ctrl+Z)">
					↶
				</button>
				<button className="mk-btn" onClick={redo} disabled={redoLen === 0} title="Redo (Ctrl+Shift+Z)">
					↷
				</button>
				<button className="mk-btn" onClick={() => setShowNotes((v) => !v)}>
					Notes ({notes.length})
				</button>
				<button className="mk-btn" onClick={clearAll}>
					Clear
				</button>
				<button
					className="mk-btn mk-send"
					disabled={notes.length === 0}
					title={notes.length === 0 ? "Mark something first" : "Screenshot + send to inbox"}
					onClick={() => setShowSend(true)}
				>
					Send →
				</button>
				<button
					className={`mk-btn${settingsOpen ? " active" : ""}`}
					onClick={() => setSettingsOpen((v) => !v)}
					title="Marksman settings"
				>
					⚙
				</button>
				<button className="mk-btn" onClick={toggle} title="Close (Esc)">
					✕
				</button>
			</div>

			{settingsOpen && (
				<div className="mk-settings" style={{ left: barPos.x, top: barPos.y + 50 }}>
					<div className="mk-settings-h">Marksman settings</div>
					<label className="mk-setrow">
						<input type="checkbox" checked={pauseOnOpen} onChange={(e) => togglePauseOnOpen(e.currentTarget.checked)} />
						<span>
							Pause gameplay when opening the markup tool
							<small>On by default. Turn off to keep the game running behind the overlay.</small>
						</span>
					</label>
				</div>
			)}

			{((recording && recTarget === "session") || recTranscript) && (
				<div className="mk-voice" style={{ left: barPos.x, top: barPos.y + 50 }}>
					<div className="mk-voice-h">
						<span className={`mk-voice-title${recording && recTarget === "session" ? " live" : ""}`}>
							{recording && recTarget === "session" ? REC_LABEL[recStatus] : "Transcript"}
						</span>
						{recording && recTarget === "session" ? (
							<button className="mk-btn" onClick={stopRec}>
								⏹ Stop
							</button>
						) : (
							<>
								<button className="mk-btn" onClick={discardTranscript} disabled={sending}>
									Discard
								</button>
								<button
									className="mk-btn mk-primary"
									onClick={submitTranscript}
									disabled={sending || !recTranscript.trim()}
								>
									{sending ? "Sending…" : "Send →"}
								</button>
							</>
						)}
					</div>
					<div className="mk-voice-body">
						{recTranscript || (recording && recTarget === "session" ? "Listening…" : "")}
					</div>
				</div>
			)}

			{showNotes && (
				<div className="mk-notes">
					<div className="mk-notes-h">Notes</div>
					{notes.length === 0 && <div className="mk-notes-empty">No notes yet — circle something or sketch.</div>}
					{notes.map((n, i) => (
						<button
							key={n.id}
							className={`mk-note-row${n.id === activeId ? " active" : ""}`}
							onClick={() => selectNote(n.id)}
						>
							<span className="mk-note-n">{i + 1}</span>
							<span className="mk-note-text">{n.comment || "(no comment)"}</span>
							<span
								className="mk-note-x"
								role="button"
								tabIndex={0}
								title="Delete"
								onClick={(e) => {
									e.stopPropagation();
									deleteNote(n.id);
								}}
								onKeyDown={() => {}}
							>
								✕
							</span>
						</button>
					))}
				</div>
			)}

			{activeNote && (
				<div className="mk-editor" style={{ left: editorPos.x, top: editorPos.y }}>
					<div className="mk-editor-h" onPointerDown={(e) => startDrag(e, () => editorPos, setEditorPos)}>
						<span>Note</span>
					</div>
					<textarea
						ref={autofocus}
						className="mk-area"
						placeholder="What about this? (sketch / type more into this note while it's open)"
						value={activeNote.comment}
						onChange={(e) => {
							// Read the value NOW — React nulls the synthetic event's currentTarget by the time the
							// setNotes updater runs (render phase), so referencing it inside the updater would throw.
							const v = e.currentTarget.value;
							updateActive((n) => ({ ...n, comment: v }));
						}}
					/>
					<div className="mk-row-end">
						{recEnabled && (
							<button
								className={`mk-btn mk-mic${recording && recTarget === "comment" ? " active" : ""}`}
								title={recording && recTarget === "comment" ? "Stop dictation" : "Dictate into this comment"}
								onClick={toggleCommentRec}
							>
								{recording && recTarget === "comment" ? `● ${recStatus}` : "🎙"}
							</button>
						)}
						<button className="mk-btn" onClick={() => deleteNote(activeNote.id)}>
							Delete
						</button>
						<button className="mk-btn mk-primary" onClick={() => setActiveId(null)}>
							Done
						</button>
					</div>
				</div>
			)}

			{textPlacing && (
				<div className="mk-textin-wrap" style={{ left: textPlacing.x, top: textPlacing.y }}>
					<input
						ref={autofocus}
						className="mk-textin"
						value={textValue}
						placeholder="type…"
						onChange={(e) => setTextValue(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitText();
							else if (e.key === "Escape") {
								setTextPlacing(null);
								setEditingText(null);
							}
						}}
						onBlur={commitText}
					/>
					{recEnabled && (
						// preventDefault on mousedown keeps focus on the input, so clicking the mic doesn't blur→commit
						<button
							className={`mk-btn mk-mic${recording && recTarget === "text" ? " active" : ""}`}
							title={recording && recTarget === "text" ? "Stop dictation" : "Dictate into this label"}
							onMouseDown={(e) => e.preventDefault()}
							onClick={toggleTextRec}
						>
							{recording && recTarget === "text" ? "●" : "🎙"}
						</button>
					)}
				</div>
			)}

			{showSend && (
				<div className="mk-modal">
					<div className="mk-modal-card">
						<div className="mk-modal-title">
							{notes.length} note{notes.length === 1 ? "" : "s"} → 1 task
						</div>
						<input
							ref={autofocus}
							className="mk-input"
							value={sendTitle}
							placeholder="Optional title (else taken from the first note)"
							onChange={(e) => setSendTitle(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") doSend();
							}}
						/>
						<div className="mk-row-end">
							<button className="mk-btn" onClick={() => setShowSend(false)} disabled={sending}>
								Cancel
							</button>
							<button className="mk-btn mk-primary" onClick={doSend} disabled={sending}>
								{sending ? "Sending…" : "Send →"}
							</button>
						</div>
					</div>
				</div>
			)}

			{toast && <div className="mk-toast">{toast}</div>}
		</>
	);
}

const MARKSMAN_CSS = `
.mk-canvas {
	position: fixed;
	inset: 0;
	width: 100%;
	height: 100%;
	z-index: 2147483000;
	cursor: crosshair;
}
/* Passive default: no tool armed ⇒ the canvas doesn't intercept pointer events (marks still render). */
.mk-canvas.mk-passthrough {
	pointer-events: none;
	cursor: default;
}
.mk-bar {
	position: fixed;
	z-index: 2147483002;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	background: rgba(18, 18, 20, 0.97);
	backdrop-filter: blur(8px);
	color: #f2f2f2;
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 10px;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
	font: 13px/1 ui-sans-serif, system-ui, sans-serif;
	user-select: none;
}
.mk-grip {
	width: 8px;
	height: 22px;
	border-radius: 4px;
	background: rgba(255, 255, 255, 0.6);
	cursor: grab;
	flex-shrink: 0;
}
.mk-grip:active {
	cursor: grabbing;
}
.mk-title {
	font-weight: 700;
	letter-spacing: 0.02em;
	padding-right: 2px;
}
.mk-spacer {
	width: 6px;
}
.mk-tool,
.mk-btn {
	appearance: none;
	border: 1px solid rgba(255, 255, 255, 0.14);
	background: rgba(255, 255, 255, 0.06);
	color: inherit;
	font: inherit;
	padding: 6px 10px;
	border-radius: 7px;
	cursor: pointer;
}
.mk-tool {
	color: var(--c);
}
.mk-tool.active {
	background: var(--c);
	color: #0a0a0a;
	border-color: var(--c);
	font-weight: 600;
}
.mk-btn:hover,
.mk-tool:hover {
	background: rgba(255, 255, 255, 0.14);
}
.mk-btn:disabled {
	opacity: 0.4;
	cursor: default;
}
.mk-primary {
	background: #2e7d32;
	border-color: #2e7d32;
	color: #fff;
}
.mk-editor {
	position: fixed;
	z-index: 2147483003;
	width: 264px;
	height: 200px;
	min-width: 220px;
	min-height: 150px;
	max-width: 90vw;
	max-height: 80vh;
	resize: both;
	display: flex;
	flex-direction: column;
	background: rgba(18, 18, 20, 0.97);
	border: 1px solid rgba(255, 59, 48, 0.55);
	border-radius: 10px;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
	overflow: hidden;
}
.mk-editor-h {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 6px 8px;
	background: rgba(255, 255, 255, 0.06);
	cursor: move;
	font: 600 12px ui-sans-serif, system-ui, sans-serif;
	color: #f2f2f2;
}
.mk-area {
	margin: 8px;
	min-height: 64px;
	flex: 1 1 auto;
	resize: none;
	background: rgba(0, 0, 0, 0.4);
	color: #f2f2f2;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 6px;
	padding: 6px 8px;
	font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
}
.mk-voice {
	position: fixed;
	z-index: 2147483002;
	width: 340px;
	max-width: 80vw;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px 12px 12px;
	background: rgba(18, 18, 20, 0.97);
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: 10px;
	box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
	font: 13px ui-sans-serif, system-ui, sans-serif;
	color: #e8e8ea;
}
.mk-voice-h {
	display: flex;
	align-items: center;
	gap: 8px;
}
.mk-voice-title {
	flex: 1;
	font-weight: 700;
}
.mk-voice-title.live {
	color: #ff453a;
}
.mk-voice-body {
	max-height: 180px;
	overflow-y: auto;
	padding: 8px;
	background: rgba(0, 0, 0, 0.35);
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 6px;
	white-space: pre-wrap;
	line-height: 1.4;
	color: #d6d6d8;
	min-height: 2.4em;
}
.mk-row-end {
	display: flex;
	justify-content: flex-end;
	gap: 6px;
	padding: 0 8px 8px;
}
.mk-textin-wrap {
	position: fixed;
	z-index: 2147483003;
	display: flex;
	align-items: stretch;
	gap: 4px;
}
.mk-textin {
	min-width: 120px;
	padding: 2px 6px;
	background: rgba(0, 0, 0, 0.7);
	color: #fff;
	border: 1px solid #00e5ff;
	border-radius: 4px;
	font: bold 16px ui-sans-serif, system-ui, sans-serif;
	outline: none;
}
/* Compact mic button used inside text boxes (note editor row + text-label box). */
.mk-mic {
	flex-shrink: 0;
	margin-right: auto; /* in the editor row: push Delete/Done to the right */
}
.mk-mic.active {
	color: #fff;
	background: #ff3b30;
	border-color: #ff3b30;
}
.mk-textin-wrap .mk-mic {
	margin-right: 0; /* beside the text-label box: sit snug to the input */
}
.mk-settings {
	position: fixed;
	z-index: 2147483002;
	width: 300px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	background: rgba(18, 18, 20, 0.97);
	border: 1px solid rgba(255, 255, 255, 0.16);
	border-radius: 10px;
	box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
	font: 13px ui-sans-serif, system-ui, sans-serif;
	color: #e8e8ea;
}
.mk-settings-h {
	font-weight: 700;
	color: #fff;
}
.mk-setrow {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	cursor: pointer;
}
.mk-setrow input {
	margin-top: 2px;
	flex-shrink: 0;
}
.mk-setrow small {
	display: block;
	color: rgba(255, 255, 255, 0.55);
	margin-top: 2px;
}
.mk-notes {
	position: fixed;
	left: 12px;
	top: 56px;
	z-index: 2147483002;
	width: 240px;
	max-height: 60vh;
	overflow: auto;
	padding: 8px;
	background: rgba(18, 18, 20, 0.95);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 10px;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
	font: 12px ui-sans-serif, system-ui, sans-serif;
	color: #e8e8ea;
}
.mk-notes-h {
	font-weight: 700;
	padding: 2px 4px 8px;
}
.mk-notes-empty {
	color: rgba(255, 255, 255, 0.5);
	padding: 4px;
}
.mk-note-row {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	text-align: left;
	appearance: none;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
	padding: 6px 4px;
	border-radius: 6px;
	cursor: pointer;
}
.mk-note-row:hover {
	background: rgba(255, 255, 255, 0.08);
}
.mk-note-row.active {
	background: rgba(42, 111, 219, 0.22);
}
.mk-note-n {
	width: 16px;
	text-align: right;
	color: rgba(255, 255, 255, 0.5);
	flex-shrink: 0;
}
.mk-note-text {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.mk-note-x {
	flex-shrink: 0;
	color: rgba(255, 255, 255, 0.4);
	padding: 0 2px;
}
.mk-note-x:hover {
	color: #ff6b6b;
}
.mk-modal {
	position: fixed;
	inset: 0;
	z-index: 2147483004;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.35);
}
.mk-modal-card {
	width: 420px;
	max-width: calc(100vw - 32px);
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 16px;
	background: rgba(20, 20, 22, 0.98);
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 12px;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
	color: #f2f2f2;
	font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
}
.mk-modal-title {
	font-weight: 600;
}
.mk-input {
	width: 100%;
	box-sizing: border-box;
	padding: 8px 10px;
	background: rgba(0, 0, 0, 0.4);
	color: #f2f2f2;
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 8px;
	font: 14px ui-sans-serif, system-ui, sans-serif;
}
.mk-fab {
	position: fixed;
	right: 16px;
	bottom: 16px;
	z-index: 2147483000;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	border: 1px solid rgba(255, 255, 255, 0.18);
	background: rgba(18, 18, 20, 0.9);
	color: #00e5ff;
	font-size: 20px;
	cursor: pointer;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.mk-fab:hover {
	background: rgba(40, 40, 44, 0.95);
}
.mk-toast {
	position: fixed;
	bottom: 16px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 2147483005;
	padding: 10px 16px;
	background: rgba(18, 18, 20, 0.96);
	color: #f2f2f2;
	border: 1px solid rgba(255, 255, 255, 0.18);
	border-radius: 8px;
	font: 13px ui-sans-serif, system-ui, sans-serif;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
	max-width: 80vw;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
`;
