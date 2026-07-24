# marksman/features/audio — optional voice transcription (dev-only)

Adds the two dev-server routes the overlay's 🎙 mic buttons call, doing **local, offline**
speech-to-text via whisper.cpp. **Off by default.**

- `POST /__marksman/recording/transcribe` — `{ audioBase64, mimeType, prompt }` → `{ transcript }`.
  Normalizes the audio to 16 kHz mono WAV (ffmpeg-static) and runs the local whisper.cpp CLI.
- `GET /__marksman/recording/status` — `{ available, whisperDir, model, reason? }` so the overlay
  gates the mic buttons (and shows a setup hint) instead of throwing when whisper isn't installed.

No LLM calls, no file writes — transcription only. The overlay routes the returned text into a note
/ text field, or (passive recorder) files it as a `source: marksman` capture like any other.

## Enabling it

Turn it on at scaffold time — `node scripts/new-game.mjs <dir> --audio` (or the interactive prompt),
which profiles the machine (`scripts/assess-whisper.mjs`), recommends a whisper model (or advises
against it), and writes the result into `marksman.config.json`:

```json
{
  "features": { "audio": true },
  "recording": { "vocabularyPrompt": "", "whisperDir": "", "model": "ggml-base.en.bin" }
}
```

`vite.config.ts` reads `features.audio` and only then wires `audioRoutes` into the endpoint.

## Requirements (provisioned out-of-band)

- **ffmpeg-static** — `npm i -D ffmpeg-static` (the `--audio` scaffold adds it). Imported lazily; a
  missing install just reports `available:false`.
- **whisper.cpp binary + a ggml model.** Resolved from `recording.whisperDir`/`model` →
  `WHISPER_DIR`/`WHISPER_MODEL` env → a platform default (Windows `C:\Shared\Models\whisper`;
  macOS/Linux `~/.cache/whisper`). Expected layout: `<whisperDir>/bin/<whisper-cli>` +
  `<whisperDir>/models/<model>.bin`. Shared machine-wide so multiple projects reuse one copy.

Model sizes (accuracy ↑, RAM/latency ↑): `tiny`(~75 MB) · `base`(~145 MB) · `small`(~490 MB) ·
`medium`(~1.5 GB) · `large-v3-turbo`(~1.6 GB). `assess-whisper.mjs` picks a fit for the machine.

## Deferred: online transcription providers (follow-up seam)

Today this feature is **local whisper.cpp only**. An online provider (e.g. a hosted STT API) is a
planned follow-up, not implemented. The clean seam to add it later:

- Introduce a `recording.provider` field in `marksman.config.json` (`"local"` | `"<online-name>"`,
  default `"local"`).
- Keep the two route names and their request/response shapes identical (`transcribe` returns
  `{ transcript }`; `status` returns `{ available, … }`) so the overlay needs no changes.
- Branch inside `handleTranscribe` / `handleStatus` on the provider: `"local"` runs the current
  whisper.cpp path; an online provider POSTs the audio to its API (reading its key from an env var,
  never committed) and maps the response to `{ transcript }`.

This keeps the overlay provider-agnostic and lets a machine that can't run whisper locally fall back
to an online service without touching the client.

## Invariants

- Dev-only. Routes exist only when the Vite dev server is running (the endpoint is `apply: 'serve'`)
  AND `features.audio` is true. Never in a production build.
- Fail soft: every missing dependency (ffmpeg, whisper CLI, model) reports `available:false` with a
  `reason` — it must never crash the dev server.
