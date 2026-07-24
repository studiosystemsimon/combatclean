# marksman — dev-only markup / feedback overlay

Floats an overlay over the running game so you can give visual feedback in place: pause,
draw a **red circle + comment**, a **cyan arrow/sketch**, or a **text label** on any
on-screen element, then hit **Send**. That writes a **raw capture** to the capture inbox
(`.cache/markdown/`) — a markdown note plus a screenshot and an *identity bundle* that
resolves each mark to the thing it points at (a DOM element's `file:line`, or a canvas
entity's `entityType`/`configPath`). It makes **no** LLM/API calls — buttons write files.
Turning a capture into a code change is a separate, explicit step: the
`transcript-to-changeset` → `run-changeset` pipeline (see `.claude/skills/`).

Vendored from the standalone Marksman tool as in-repo source (not a dependency),
specifically so it's yours to customize after the game is generated.

## What's here

| File | Role |
|---|---|
| `Marksman.tsx` | The whole overlay UI (toolbar, canvas, notes, send modal, voice panel) + its CSS. |
| `index.ts` | Public barrel — `mountMarksman(target, adapter)`, the emit helpers, and all types. |
| `mount.ts` | Skeleton mount shim `mountMarksmanOverlay()` — builds the minimal GameAdapter and mounts. |
| `types.ts` | The `GameAdapter` seam + all data types (`Note`, `AnnotationTarget`, `CanvasHit`, …). |
| `emit.ts` | Builds the raw capture (markdown + identity bundle) and POSTs it to the endpoint. |
| `resolve.ts` | DOM/canvas target resolution (CSS path, React/Svelte/Vue dev metadata, hit-scan). |
| `internal/` | Input key-guard + the voice recorder (VAD + `MediaRecorder`) and its tunables. |
| `endpoint.mjs` | The dev-server file-write backend (a Vite plugin). Writes captures to `.cache/markdown/`. |
| `features/audio/` | Optional voice transcription (whisper.cpp). Off by default; see SETUP.md. |

## How it's wired

`src/main.ts` mounts it behind a guard:

```ts
if (import.meta.env.DEV && window.self !== window.top) {
  import('./marksman').then(({ mountMarksmanOverlay }) => mountMarksmanOverlay());
}
```

- `import.meta.env.DEV` — dev-server only; Vite dead-code-eliminates this whole branch from
  production builds (`npm run build`), so none of this ships to players.
- `window.self !== window.top` — the real game view renders **inside** the `src/preview`
  device-frame iframe, so we overlay the game there, not the outer bezel chrome. If you
  remove `src/preview`, flip this to `window.self === window.top`.

The backend is a **Vite plugin** registered in `vite.config.ts`:

```ts
import marksmanEndpoint from './src/marksman/endpoint.mjs';
export default defineConfig({ plugins: [/* … */ marksmanEndpoint()] });
```

It is `apply: 'serve'`, so it exists only on the dev server and is absent from the build.
Capture location comes from `marksman.config.json` (`inboxDir` / `assetsDir`, default
`.cache/markdown/`).

## The GameAdapter seam (the only game-specific surface)

`mount.ts` supplies a minimal adapter. Only `setPaused` is required; the rest are optional
and the overlay degrades gracefully without them:

| Method | Required | Purpose |
|---|---|---|
| `setPaused(paused)` | yes | Freeze the sim while drawing, resume on close. The skeleton stub is a no-op (no run loop yet); wire it to `src/app` once you have one. |
| `captureFrame()` | no | Return a composite screenshot (canvas + DOM HUD) so Send writes a real `screenshot.png`. Without it, captures still record marks + resolved targets. |
| `hitTestCanvas(x, y)` | no | Resolve a screen pixel to a canvas entity identity (`entityType` + `configPath`) so marks on canvas-drawn things pin to a real entity, not just a DOM node. |

## Voice / audio (optional)

The 🎙 buttons do local, offline speech-to-text via whisper.cpp — **off by default**. Enable
it at scaffold time (`new-game.mjs --audio`, or the interactive prompt) which flips
`features.audio` in `marksman.config.json` and points `recording.whisperDir`/`model` at a
local whisper install. See `features/audio/README.md` and `SETUP.md`.

## Invariants

- **Dev tooling, not a game module.** Not gated by DI/signals — never touches `world.bus`,
  the composition root, or `src/data`. Exempt from the eight architecture hard rules (like
  `src/preview`).
- **Must never reach a production build.** If you change the mount site, keep it behind
  `import.meta.env.DEV`; keep the endpoint `apply: 'serve'`.
- **No LLM calls in the tool.** Send writes files; processing is the changeset pipeline's job.
