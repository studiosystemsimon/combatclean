# @bishop/asset-registry

A **portable, format-agnostic asset database**. Project-agnostic engine scope (`@bishop/*`):
it knows nothing about Recipe Raiders or any specific renderer.

## What it does

- Scans a folder tree for `assets.json` files + one root `aliases.json`.
- Exposes every asset by a unique **`assetId`** (`Map<assetId, ResolvedAsset>`).
- Resolves each asset's bundle-able **files** and any opaque **derived** metadata.
- Redirects meaningful game names → pack ids via aliases (no pack renaming).
- Validates the whole database against per-type **zod** schemas.

## The one fixed rule: content is OPAQUE

An asset declaration is only `{ type: string, …anything… }`. This package never inspects the
body and has **no list of asset types**. Do **not** edit this package to add a format, and never
add a `switch (declaration.type)` here.

## Extending — register a format, don't fork the core

A format package teaches the registry a `type` in two independent halves (split so zod never
reaches the client bundle):

- `registerAssetFileExtractor(type, fn)` — **runtime**, no zod. How to resolve the type's files
  (+ `derived` metadata) from its declaration. Falls back to a generic convention walker
  (`file`/`files`/`folder` keys + media-extension sniff) when a type registers none.
- `registerAssetSchema(type, zodSchema)` — **build/authoring**. The zod schema validating a
  declaration of this type. Imported only by the CLI and the vite plugin.

See `@bishop/asset-types-2d` for the reference implementation (spritesheets + Tiled tilesets).

## Entry points

- `.` — browser-safe: `buildRegistryFromManifests`, `applyAliases`, `resolveFilePath` /
  `resolveAllFilePaths`, the `register*` hooks, `validateDeclaration` / `validateManifest`,
  and the trim API. No `node:fs`, no zod runtime.
- `./node` — `scanAssetsDir(root)` + `validateAssetsDir(root)` (walk the disk tree).
- `./vite` — `assetRegistryPlugin({ registerFormats, runtimeFormatModules })` →
  `virtual:asset-registry` exporting `{ registry, urlById }` (`registry` = post-processing
  `Map<assetId, ResolvedAsset>`; `urlById` = `Record<assetId, Record<authoredFileToken, url>>` —
  resolution is by assetId, never by file path). A project wrapper supplies
  `registerFormats` (imports the format packages it depends on) since the agnostic package can't
  resolve them under pnpm.

## Conventions this package relies on

- **`*AssetId` references.** Any config field whose name ends in `assetId` (or `assetIds`) is an
  asset reference. `collectAssetIds(config)` + `requiredFilesFor(registry, ids)` use this to
  package only the assets a build actually uses. No hardcoded paths anywhere.

## Scaffold CLI (the `assets` registry)

FrogGame's unified `config/scaffold.mjs assets …` front door composes this package's existing
exports — `scanAssetsDir`/`validateAssetsDir` (node), `getAssetSchema`/`listAssetTypes`/
`validateDeclaration` (`.`) — with `describeSchema` from `@bishop/config-registry` for its
`fields <type>` verb. Nothing is added here: keeping the schema-introspection dependency
out of this package preserves the "opaque, independent twin" design (no edge to
config-registry). The reverse-ref scan (`assets refs <assetId>`) lives game-side because it
spans the config + visual consumers.

## Validation as a gate

- Build: `assetRegistryPlugin` fails the build on any schema error.
- CLI: `validate-assets <root> --schema <module> …` (non-zero exit on error) — for CI, a
  pre-commit hook, or an agent PostToolUse hook that checks AI edits to any `assets.json`.
- Agent edits: FrogGame's blocking PreToolUse hook (`config/validate-edit-hook.mjs`) calls
  `validateManifest` on any edited `assets/**/assets.json` before the write lands.
