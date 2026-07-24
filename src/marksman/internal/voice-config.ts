// Tunables for the overlay's voice dictation (the 🎙 Voice toolbar button). Plain constants — dev-time
// dictation, never shipped to the host game's runtime. Ported from the swarm editor's voice control.

export interface VoiceConfig {
	/** RMS (0..1) above which a frame counts as speech. Mic-dependent. */
	speechThreshold: number;
	/** ms of sustained loudness before an utterance starts (debounces clicks). */
	onsetMs: number;
	/** ms of sustained silence that ends an utterance. */
	silenceMs: number;
	/** VAD sampling interval. */
	pollMs: number;
	/** ms of quiet after arming before a transient (click/cough) is discarded. */
	blipMs: number;
	/** MediaRecorder mime candidates; first supported one wins. */
	mimeCandidates: string[];
}

export const VOICE_CONFIG: VoiceConfig = {
	speechThreshold: 0.015,
	onsetMs: 120,
	// 2800ms allows substantial thinking pauses between sentences without splitting the utterance —
	// important for longer, freeform spoken feedback.
	silenceMs: 2800,
	pollMs: 50,
	blipMs: 150,
	mimeCandidates: ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"],
};
