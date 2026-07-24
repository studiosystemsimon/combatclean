# @bishop/asset-types-2d

Defines the **2D web-game asset formats** and registers them with `@bishop/asset-registry`.
Engine scope (`@bishop/*`) — reusable by any 2D web game, not Recipe-Raiders-specific. A likely
future home is a `@bishop/game-view-2d` renderer that owns these definitions.

## Formats

- `sprite-animation` — spritesheet with named animation clips (row/frames/fps).
- `sprite-atlas` — spritesheet with named sub-sprites.
- `frames` — animation from a folder of frame files.
- `image` — a single static image.
- `tileset` — a **Tiled** (`.tsx`) tileset (indirection: the `.tsx` points at the image).
- `automap-rule` — a Tiled (`.tmx`) automap rule file.
- `audio` — one or more audio files.

## Zod is the single source of truth

Each format is a zod schema in `src/schema.ts`; the TypeScript types are `z.infer`'d from those
schemas — change the schema and the type follows. **This is the place to extend when a 2D format
changes** — never the agnostic `@bishop/asset-registry` core.

## Two entry points

- `.` — runtime. Importing it **registers the file extractors** (side-effect) so
  `resolveFilePath`/`derived` work for these types, and exports the format TS types +
  `resolveTilesetMeta` / `getResolvedTileset`. Zod-free (stays out of the client bundle).
- `./schema` — build/authoring. Importing it **registers the zod schemas** for validation.
  Imported by the asset-registry CLI and vite plugin; never by the client.

## Wiring

- Client bundle (via the vite plugin): `formatModules: ["@bishop/asset-types-2d"]`.
- Validation (CLI / plugin): `schemaModules: ["@bishop/asset-types-2d/schema"]`.
- Only `tileset` (TSX→image indirection) and `frames` (folder-based) need explicit extractors;
  the rest resolve through the core's convention walker.
