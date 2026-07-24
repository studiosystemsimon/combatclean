# @bishop/config-registry

A **portable, game-AGNOSTIC logical-config system**. Engine scope (`@bishop/*`): it knows nothing
about Recipe Raiders' categories, ids, or field names. Twin of `@bishop/asset-registry` — but where
assets are *opaque* (no schema), config is *schema-driven*, so the schema is the single source of
truth for both shape AND references.

## What it does

- A game declares its content format as a `ConfigCategory[]` **manifest** (kind + folder + Zod schema
  + id lane). The engine is generic over it — no hardcoded categories/lanes/ref-field names.
- Allocates globally-unique numeric ids per lane, **never reused** (monotonic high-water `_id-ledger.json`).
- Validates a merged catalog: schema shape (strict → unknown keys fail), id/key uniqueness, lane
  conformance, and **referential integrity** (every ref resolves to the right target category).
- Inspects: `expand <id>` (inline outgoing refs) / `refs <id>` (reverse-walk).

## The contract

- **id-kind** — `zConfig` = `{ id: number, displayName, tags? }`. Referenced by `configRef(target)`.
- **key-kind** — `zKeyConfig` = `{ displayName, tags? }` + an enum-derived key (manifest `keyField`).
  Referenced by `stringConfigRef(target)`.
- **References are DECLARED IN THE SCHEMA**, not inferred from field names:
  `configRef("enemies")` / `stringConfigRef("elements")` stamp Zod `.meta()`, which the engine reads
  (via `z.toJSONSchema`) to build the ref index. The `*ConfigId(s)` naming stays as an enforced lint
  (`lintRefNaming`) — greppable for humans, but the machine trusts the schema (typo-proof, target-aware).

## Extending — supply a manifest, don't fork the core

A game defines its schemas with `zConfig`/`zKeyConfig` + `configRef`/`stringConfigRef` and exports a
`CATEGORIES: ConfigCategory[]`. Recipe Raiders' manifest lives in `@recipe-raiders/core` (core owns
its own config types; it just complies with this contract). Never add a game's category here.

## Schema → format-info (`describeSchema`)

`describeSchema(schema)` (and its pretty-printer `formatFields(schema, title?)`) turn ANY Zod
object schema into a flat field table — `{ name, type, optional, description, refTarget }` —
by reading the same `z.toJSONSchema` output the ref index uses, so a field's declared
`configRef`/`stringConfigRef` target surfaces next to its type. It is the one game-agnostic
home for the scaffold CLI's `fields` verb; the config, visual (VSM), and asset scaffolds all
call it, even though visual/asset schemas aren't config categories. Kept here (not in
asset-registry) so asset-registry stays an independent twin with no cross-package dep.

## Entry points

- `.` — browser-safe: base + helpers, `buildRefIndex`, `validateMerged`/`assertValidMerged`,
  `expand`/`findRefs`, `nextId`/`nextIds`, `nextIdForConfig` (in-memory allocation — mutates the passed
  config's `nextId` so an editor can add several entities before a reload), `lintRefNaming`,
  `describeSchema`/`formatFields`. No `node:fs`.
- `./node` — per-entity + ledger disk I/O: `scanConfigDir`/`loadContext`, `writeEntity`/`createEntity`,
  the id-ledger read/write/bump, migrations.
- `./vite` — `gameConfigPlugin({ gameDir, manifest, compose? })` → `virtual:game-config`. The wrapper
  passes the manifest + a `compose` hook for game EXTRAS the engine doesn't own (`_global.json`
  singletons, string-id catalogs, the derived `nextIds`).

## Validation as a gate

- CLI: `config-registry --manifest <mod> --game-dir <path> validate` (non-zero exit) — CI / pre-commit
  / agent hook. Also `lint` (ref naming), `fields <category>` (schema field docs), `create`, `list`,
  `expand`, `refs`.
- Build: `gameConfigPlugin` fails the build on any schema/ref/id error.
