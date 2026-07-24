# @bishop/asset-processors

Two **reference build-time asset processors** for `@bishop/asset-registry`. Engine scope (`@bishop/*`):
game-agnostic. **Node-only** — shells out to `ffmpeg`. These are the common cases the engine ships; a
game defines its own processors the same way.

## What it ships

- `image-convert` (MAP) — PNG/JPG/TGA/WebP → WebP/PNG/JPG, optional longest-edge clamp (never enlarges).
- `audio-convert` (MAP) — WAV/AIFF/FLAC/… → MP3/OGG, optional channels / sample-rate / metadata-strip.

Both are **MAP** processors (one artifact in → one out). Importing this module **registers them**
(side-effect), mirroring how a format package registers its extractors. A game references one by id in
its build profile: `{ use: "image-convert", format: "webp", maxDim: 1024 }`.

## Extending — register a processor, don't fork the core

A processor is `registerAssetProcessor({ id, kind, version, accepts, toolVersion, optionsSchema, process })`
from `@bishop/asset-registry/node`. `optionsSchema` is a zod schema (validated + defaulted per invocation);
`version` + `toolVersion` key the build cache. Define new ones **in the game** (or a new
`@bishop/*` package if broadly reusable) — e.g. a `frames-pack` FOLD processor driving TexturePacker.

## When NOT to extend

- **Don't add a game-specific processor here.** This package is the generic ffmpeg pair; game-shaped
  processing (atlasing to a game's layout, game-specific naming) belongs in the game.
- **Don't add a heavy image lib.** ffmpeg is reused for images to avoid a `sharp` dependency
  (see the `ponytail:` note in `ffmpeg.ts`); reach for `sharp` only if image quality/speed measurably
  needs it, and put it behind a new processor — don't rewrite these.
- **Never import this from the browser-safe registry core** — it's node-only.

## Known smell

`image-convert` and `audio-convert` share the same map-over-artifacts + extension-swap shape
(`src/index.ts`). A `createFfmpegMapProcessor()` factory would DRY it — deferred; two cases don't earn
the abstraction yet. Extract it if a third ffmpeg processor lands.
