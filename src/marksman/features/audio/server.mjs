// Audio feature — dev-server route contribution (voice transcription). DEV ONLY.
//
// Handed to `marksmanEndpoint`/`createMarksmanMiddleware` via `opts.features` (see endpoint/index.mjs)
// when the audio feature is enabled. Adds the two routes the overlay's 🎙 mic buttons call. Import from
// "@fortis/marksman/features/audio/server":
//
//   import { marksmanEndpoint } from "@fortis/marksman/vite";
//   import { audioRoutes } from "@fortis/marksman/features/audio/server";
//   export default defineConfig({ plugins: [marksmanEndpoint({ features: [audioRoutes] })] });
//
// Routes under /__marksman/recording/:
//   POST transcribe   { audioBase64, mimeType, prompt } → { transcript }
//                      Decodes the audio, normalizes it to 16 kHz mono WAV with ffmpeg-static, runs the
//                      local whisper.cpp CLI, returns the text. Transcription-only — no LLM, no file
//                      writes; the overlay routes the transcript into a note/text field or a session task.
//   GET  status        → { available, whisperDir, model, reason? }
//                      Lets the overlay gate the mic buttons + surface a setup hint instead of throwing.
//
// Whisper lives OUTSIDE the tool (a native binary + model, ~75 MB for `base` up to ~1.6 GB for
// `large-v3-turbo`), shared machine-wide so multiple projects reuse one copy. Location resolves:
// marksman.config.json `recording.whisperDir`/`model` → WHISPER_DIR/WHISPER_MODEL env → a platform
// default (Windows: C:\Shared\Models\whisper; macOS/Linux: ~/.cache/whisper) + the model named in
// config (fallback ggml-base.en.bin). Provision it out-of-band (a whisper.cpp build dropped at
// <whisperDir>/bin/ + a ggml model at <whisperDir>/models/). `scripts/assess-whisper.mjs` recommends
// which model this machine can run; the scaffold prompt (new-game.mjs) writes the choice into config.
//
// ffmpeg-static is required for audio normalization — install it when you add this feature
// (`npm i -D ffmpeg-static`). It's imported lazily, so a missing install just reports available:false
// (with a helpful reason) rather than crashing the dev server.
//
// Transcription core ported from the swarm editor's dev voice plugin.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Platform-aware default whisper location (overridden by config/env). Windows keeps the historical
// shared path; macOS/Linux use a writable per-user cache dir so no admin/shared-drive setup is needed.
const DEFAULT_WHISPER_DIR =
	process.platform === "win32" ? "C:\\Shared\\Models\\whisper" : path.join(os.homedir(), ".cache", "whisper");
const DEFAULT_MODEL = "ggml-base.en.bin";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Config resolution — read the adopter's marksman.config.json `recording` block, then env, then default.
// `cfg` is the endpoint's resolved options (has .root + .configPath).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function readRecordingConfig(cfg) {
	try {
		const raw = fs.readFileSync(path.join(cfg.root, cfg.configPath), "utf8");
		const { _comment, ...parsed } = JSON.parse(raw);
		return parsed.recording && typeof parsed.recording === "object" ? parsed.recording : {};
	} catch {
		return {};
	}
}

function resolveWhisper(cfg) {
	const rec = readRecordingConfig(cfg);
	const whisperDir =
		(typeof rec.whisperDir === "string" && rec.whisperDir) || process.env.WHISPER_DIR || DEFAULT_WHISPER_DIR;
	const model = (typeof rec.model === "string" && rec.model) || process.env.WHISPER_MODEL || DEFAULT_MODEL;
	return {
		whisperDir,
		binDir: path.join(whisperDir, "bin"),
		modelPath: path.join(whisperDir, "models", model),
		modelName: model,
	};
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// whisper.cpp discovery + invocation
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Locate the whisper CLI exe under binDir (the release zip layout has shifted over versions). */
function findWhisperExe(binDir) {
	if (!fs.existsSync(binDir)) return null;
	const candidates = ["whisper-cli.exe", "main.exe", "whisper.exe", "whisper-cli", "main", "whisper"];
	const seen = [];
	(function walk(dir) {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) walk(full);
			else if (candidates.includes(e.name)) seen.push(full);
		}
	})(binDir);
	for (const c of candidates) {
		const hit = seen.find((p) => path.basename(p) === c);
		if (hit) return hit;
	}
	return null;
}

/** Availability: whisper CLI + model both present, and ffmpeg-static importable. */
async function checkAvailable(w) {
	const exe = findWhisperExe(w.binDir);
	if (!exe) return { available: false, reason: `whisper CLI not found under ${w.binDir}` };
	if (!fs.existsSync(w.modelPath)) return { available: false, reason: `model not found: ${w.modelPath}` };
	const ffmpeg = await loadFfmpeg();
	if (!ffmpeg) return { available: false, reason: "ffmpeg-static not installed (npm i -D ffmpeg-static)" };
	return { available: true };
}

let _ffmpegPath;
/** Lazily import ffmpeg-static. Returns the binary path or null if it isn't installed. */
async function loadFfmpeg() {
	if (_ffmpegPath !== undefined) return _ffmpegPath;
	try {
		const mod = await import("ffmpeg-static");
		_ffmpegPath = mod.default || mod;
	} catch {
		_ffmpegPath = null;
	}
	return _ffmpegPath;
}

function runCapture(cmd, args) {
	const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
	return {
		status: r.status ?? -1,
		stdout: r.stdout ? r.stdout.toString() : "",
		stderr: r.stderr ? r.stderr.toString() : "",
	};
}

function convertToWav(ffmpeg, inputPath, outputPath) {
	const r = runCapture(ffmpeg, [
		"-y",
		"-loglevel",
		"error",
		"-i",
		inputPath,
		"-ac",
		"1",
		"-ar",
		"16000",
		// Loudness-normalize: desktop mics often capture low; without this whisper's own VAD treats it as
		// silence and returns [BLANK_AUDIO].
		"-af",
		"dynaudnorm=p=0.9:s=5",
		"-f",
		"wav",
		outputPath,
	]);
	if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}: ${r.stderr.slice(0, 400)}`);
}

function transcribeLocal(exe, modelPath, wavPath, prompt) {
	const args = ["-m", modelPath, "-f", wavPath, "-nt", "-l", "en"];
	if (prompt) args.push("--prompt", prompt); // vocabulary bias for uncommon/domain words
	const r = runCapture(exe, args);
	if (r.status !== 0) throw new Error(`whisper exited ${r.status}: ${r.stderr.slice(0, 400)}`);
	// Strip whisper.cpp's [BLANK_AUDIO] markers + collapse whitespace.
	return r.stdout
		.replace(/\[BLANK[_ ]AUDIO\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// http helpers (host-agnostic — mirror endpoint/index.mjs)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 25 * 1024 * 1024) {
				reject(new Error("payload too large"));
				req.destroy();
			}
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(payload));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** GET /__marksman/recording/status — is local transcription ready? */
async function handleStatus(cfg, req, res) {
	const w = resolveWhisper(cfg);
	const chk = await checkAvailable(w);
	sendJson(res, 200, {
		available: chk.available,
		whisperDir: w.whisperDir,
		model: w.modelName,
		...(chk.reason ? { reason: chk.reason } : {}),
	});
	return true;
}

/** POST /__marksman/recording/transcribe — audio → transcript via ffmpeg + whisper.cpp. */
async function handleTranscribe(cfg, req, res) {
	if (req.method !== "POST") {
		sendJson(res, 405, { error: "method not allowed" });
		return true;
	}
	const w = resolveWhisper(cfg);
	const exe = findWhisperExe(w.binDir);
	const ffmpeg = await loadFfmpeg();
	if (!exe || !fs.existsSync(w.modelPath) || !ffmpeg) {
		const chk = await checkAvailable(w);
		sendJson(res, 500, {
			error: `Local whisper not ready (${chk.reason ?? "unavailable"}). Set recording.whisperDir in marksman.config.json (or have the host framework provision whisper.cpp).`,
		});
		return true;
	}

	let tmpDir;
	try {
		const body = await readBody(req);
		const { audioBase64, mimeType, prompt } = JSON.parse(body);
		if (typeof audioBase64 !== "string" || !audioBase64.length) {
			sendJson(res, 400, { error: "audioBase64 missing or empty" });
			return true;
		}
		const audioBuffer = Buffer.from(audioBase64, "base64");
		const ext = (String(mimeType ?? "").split("/")[1] ?? "webm").replace(/[^a-z0-9]/gi, "") || "webm";

		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marksman-voice-"));
		// Distinct names so ffmpeg never sees output == input (e.g. a wav-in, wav-out collision).
		const rawPath = path.join(tmpDir, `in-raw.${ext}`);
		const wavPath = path.join(tmpDir, "out.wav");
		fs.writeFileSync(rawPath, audioBuffer);
		convertToWav(ffmpeg, rawPath, wavPath);
		const transcript = transcribeLocal(exe, w.modelPath, wavPath, typeof prompt === "string" ? prompt.trim() : "");
		sendJson(res, 200, { transcript });
	} catch (e) {
		sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
	} finally {
		if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
	}
	return true;
}

/** This feature's route contribution — pass in `marksmanEndpoint({ features: [audioRoutes] })`. */
export const audioRoutes = {
	routes: [
		["/__marksman/recording/transcribe", handleTranscribe],
		["/__marksman/recording/status", handleStatus],
	],
};

export default audioRoutes;
