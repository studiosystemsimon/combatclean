// Continuous, hands-free voice capture for the Marksman overlay (dev-only dictation).
//
// Toggle on → opens the desktop mic, listens continuously, and segments speech into discrete utterances.
// Each utterance is silence-delimited by a simple RMS VAD; a fresh MediaRecorder per utterance yields an
// independently-decodable webm blob that is POSTed to the host's `/__marksman/recording/transcribe`
// endpoint (local whisper.cpp). Each resulting transcript is handed to onTranscript — the overlay
// appends it to the active note's comment, so voice flows through the same task pipeline as typed text.
//
// The client never loads a model: capture is browser-native (getUserMedia + Web Audio + MediaRecorder)
// and transcription happens server-side. Ported from the swarm editor's VoiceController.

import { VOICE_CONFIG, type VoiceConfig } from "./voice-config";

export type VoiceStatus = "off" | "listening" | "hearing" | "transcribing";

export interface VoiceCallbacks {
	/** Coarse lifecycle status for the UI pill. */
	onStatus?: (status: VoiceStatus) => void;
	/** Per-utterance transcript (one silence-delimited utterance of speech). */
	onTranscript?: (text: string) => void;
	/** Non-fatal error (permission denied, transcription failure, …). */
	onError?: (message: string) => void;
}

export interface VoiceOptions {
	/** Where to POST each utterance for transcription. Default: "/__marksman/recording/transcribe". */
	endpoint?: string;
	/** Initial-prompt vocabulary bias sent to whisper per utterance (domain jargon). Default: none. */
	vocabularyPrompt?: string;
	/** VAD/recorder tunables. Default: VOICE_CONFIG. */
	config?: VoiceConfig;
}

/** Append a freshly-transcribed utterance to the accumulating session transcript (space-joined, no leading
 *  space on an empty buffer). Kept pure + exported so the overlay's transcript routing is unit-testable. */
export function appendTranscript(existing: string, text: string): string {
	return existing ? `${existing} ${text}` : text;
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const fr = new FileReader();
		fr.onloadend = () => {
			const s = String(fr.result ?? "");
			const comma = s.indexOf(",");
			resolve(comma >= 0 ? s.slice(comma + 1) : s);
		};
		fr.onerror = () => reject(fr.error ?? new Error("FileReader failed"));
		fr.readAsDataURL(blob);
	});
}

export class VoiceController {
	private readonly cfg: VoiceConfig;
	private readonly cb: VoiceCallbacks;
	private readonly endpoint: string;
	private readonly vocabularyPrompt: string;

	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private buf: Uint8Array<ArrayBuffer> | null = null;
	private pollTimer: number | null = null;

	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private recMime = "";

	// VAD state. `armed` = recording has started on the first loud frame (so the word onset isn't
	// clipped) but the utterance isn't confirmed yet; `speaking` = confirmed (sustained past onsetMs). A
	// transient that never confirms is discarded without transcription.
	private armed = false;
	private armedSince = 0;
	private speaking = false;
	private belowSince = 0;
	private discardNext = false;

	constructor(cb: VoiceCallbacks, opts: VoiceOptions = {}) {
		this.cb = cb;
		this.cfg = opts.config ?? VOICE_CONFIG;
		this.endpoint = opts.endpoint ?? "/__marksman/recording/transcribe";
		this.vocabularyPrompt = opts.vocabularyPrompt ?? "";
	}

	get active(): boolean {
		return this.stream != null;
	}

	async start(): Promise<void> {
		if (this.stream) return;
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

		const Ctx: typeof AudioContext =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		this.ctx = new Ctx();
		const src = this.ctx.createMediaStreamSource(this.stream);
		this.analyser = this.ctx.createAnalyser();
		this.analyser.fftSize = 1024;
		this.buf = new Uint8Array(this.analyser.fftSize);
		src.connect(this.analyser);

		this.recMime = this.cfg.mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
		this.armed = false;
		this.armedSince = 0;
		this.speaking = false;
		this.belowSince = 0;
		this.discardNext = false;
		this.setStatus("listening");
		this.pollTimer = window.setInterval(() => this.tick(), this.cfg.pollMs);
	}

	stop(): void {
		if (this.pollTimer != null) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.recorder && this.recorder.state !== "inactive") {
			try {
				this.recorder.stop();
			} catch {
				/* ignore */
			}
		}
		this.recorder = null;
		this.chunks = [];
		if (this.ctx) {
			this.ctx.close().catch(() => {});
			this.ctx = null;
		}
		if (this.stream) {
			this.stream.getTracks().forEach((t) => t.stop());
			this.stream = null;
		}
		this.analyser = null;
		this.buf = null;
		this.armed = false;
		this.speaking = false;
		this.setStatus("off");
	}

	private setStatus(s: VoiceStatus): void {
		this.cb.onStatus?.(s);
	}

	private rms(): number {
		if (!this.analyser || !this.buf) return 0;
		this.analyser.getByteTimeDomainData(this.buf);
		let sum = 0;
		for (let i = 0; i < this.buf.length; i++) {
			const v = (this.buf[i] - 128) / 128;
			sum += v * v;
		}
		return Math.sqrt(sum / this.buf.length);
	}

	private tick(): void {
		const now = Date.now();
		const loud = this.rms() >= this.cfg.speechThreshold;

		if (this.speaking) {
			if (loud) {
				this.belowSince = 0;
			} else {
				if (this.belowSince === 0) this.belowSince = now;
				if (now - this.belowSince >= this.cfg.silenceMs) this.endUtterance();
			}
			return;
		}

		if (this.armed) {
			if (loud) {
				this.belowSince = 0;
				if (now - this.armedSince >= this.cfg.onsetMs) this.confirmUtterance();
			} else {
				// Quiet again before confirming → a click/cough, not speech: discard.
				if (this.belowSince === 0) this.belowSince = now;
				if (now - this.belowSince >= this.cfg.blipMs) this.discardUtterance();
			}
			return;
		}

		// Idle: the very first loud frame starts recording immediately, so the word onset is captured
		// (pre-roll) rather than clipped by onsetMs.
		if (loud) this.armUtterance(now);
	}

	private armUtterance(now: number): void {
		if (!this.stream) return;
		this.armed = true;
		this.armedSince = now;
		this.belowSince = 0;
		this.discardNext = false;
		this.chunks = [];
		try {
			this.recorder = this.recMime
				? new MediaRecorder(this.stream, { mimeType: this.recMime })
				: new MediaRecorder(this.stream);
		} catch {
			this.recorder = new MediaRecorder(this.stream);
		}
		this.recorder.ondataavailable = (e) => {
			if (e.data && e.data.size) this.chunks.push(e.data);
		};
		this.recorder.onstop = () => {
			void this.flush();
		};
		this.recorder.start();
		this.setStatus("hearing");
	}

	private confirmUtterance(): void {
		this.armed = false;
		this.speaking = true;
		this.belowSince = 0;
	}

	private discardUtterance(): void {
		this.armed = false;
		this.belowSince = 0;
		this.discardNext = true;
		if (this.recorder && this.recorder.state !== "inactive") {
			try {
				this.recorder.stop();
			} catch {
				/* onstop → flush no-ops on discard */
			}
		}
		this.setStatus("listening");
	}

	private endUtterance(): void {
		this.speaking = false;
		this.belowSince = 0;
		if (this.recorder && this.recorder.state !== "inactive") {
			try {
				this.recorder.stop();
			} catch {
				/* onstop still fires flush */
			}
		}
		this.setStatus("listening");
	}

	private async flush(): Promise<void> {
		const chunks = this.chunks;
		const rec = this.recorder;
		const discard = this.discardNext;
		this.chunks = [];
		this.recorder = null;
		this.discardNext = false;
		if (discard || !chunks.length) return;

		const blob = new Blob(chunks, { type: rec?.mimeType || this.recMime || "audio/webm" });
		this.setStatus("transcribing");
		try {
			const audioBase64 = await blobToBase64(blob);
			const res = await fetch(this.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ audioBase64, mimeType: blob.type, prompt: this.vocabularyPrompt }),
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
			const text = String((json as { transcript?: string }).transcript ?? "").trim();
			if (text) this.cb.onTranscript?.(text);
		} catch (e) {
			this.cb.onError?.((e as Error).message);
		} finally {
			if (this.stream) this.setStatus(this.speaking ? "hearing" : "listening");
		}
	}
}
