# config (scaffold CLI) — the authoring front door + blocking validation hook

The one agent/human-facing surface for authoring content across the three registries without reading
source, plus the write-time guard.

- `scaffold.mjs` — `node config/scaffold.mjs <registry> <verb> [args]` where
  `registry ∈ config | visual | assets`. Verbs: `list` / `fields` (the Zod schema as a field table —
  the authoring contract) / `show` / `create` / `validate`.
- `validate-edit-hook.mjs` — PreToolUse blocking hook: on Edit/Write/MultiEdit to a registry data
  file, reconstructs the would-be content, validates it against the same schema, and exits `2`
  (blocking the write) on failure. Non-registry paths exit `0` immediately. Wired in
  `.claude/settings.json`.
- `registries/{config,visual,assets}.mjs` — the per-registry adapters `scaffold.mjs` dispatches to.

**Invariants**
- The **same Zod schemas** power the CLI, the build (`virtual:game-config`), and the edit hook —
  fails in one → fails in all.
- The edit hook does per-file **SHAPE** validation only (fast). Full cross-entity ref integrity
  (dangling `configRef` / missing `assetId`) is `node config/scaffold.mjs <registry> validate` + the
  build gate — NOT the hook.
- New ids come from the manifest's never-reuse lanes (`_id-ledger.json`); never hand-pick an id.
