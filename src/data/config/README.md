# config — the three-registry logical-config data layer

Content as schema-validated JSON via the real `@bishop/*` engine, linked by one id/key across three
registries.

- `manifest.ts` — `CATEGORIES`, the contract SSOT: every category's kind (id / key / singleton),
  folder under `game/`, Zod schema, and (id-kind) never-reuse id lane. The build
  (`virtual:game-config`), the scaffold CLI, and the edit hook ALL read this one file.
- `schemas/` — the per-category Zod schemas (data-only; no per-schema README).
- `repository.ts` — logical runtime repo over the baked bundle (id/key → entry).
- `ui-config-repository.ts` — the presentation leg (display name/colour/icon assetId).
- `game/**` + `ui/**` — per-entity JSON, data-only (content, not code — no per-folder README).

**Invariants**
- `manifest.ts` is the single contract — "fails in one → fails in all" (CLI, build, edit hook).
- **zod never enters the browser bundle**: `repository.ts` infers a category's kind from the data (an
  entry has a numeric `id` or a string `key`), so it never imports the manifest.
- `ui-config-repository.ts` imports neither the logical repo nor a data adapter → cycle-safe (the
  logical repo backfills presentation **from** it).
- Ids never reuse (`_id-ledger.json` high-water). Content is baked + statically imported
  (Capacitor-safe — no runtime `fetch`).
- Author via `config/scaffold.mjs`; the PreToolUse edit hook re-validates every write; run
  `npm run game-config:validate` for cross-entity ref integrity.
