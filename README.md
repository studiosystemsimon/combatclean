# Combat Clean

A **blank, data-driven merge + auto-battler starter** — the bishop-game-framework app skeleton + the
real `@bishop/*` engine (vendored in `packages/bishop/`), wired to the three-registry data-layer
contracts modelled on **MergeCombat's** systems. No gameplay loop yet; the machinery is what ships,
and it **builds reliably and consistently** (`npm run build` + the config gates are green).

## Run

```bash
npm install        # also builds the vendored @bishop packages (postinstall → build:packages)
npm run dev        # boots the placeholder; the boot screen shows a data-source marker
npm run build      # build:packages → tsc → vite build (the full gate)
```

The boot screen renders a verification marker — `cfg#<schemaVersion> · N categories · M entries · K
assets` — proving the baked `virtual:game-config` + `virtual:asset-registry` are the source.

## The data layer (author content here)

Everything is schema-validated JSON across **three registries linked by one identity** (numeric `id`
= id-kind, string `key` = key-kind). The manifest `src/data/config/manifest.ts` is the contract SSOT
the build, the CLI, and the edit hook all read. See `CLAUDE.md` → *Data layer* for the full rules.

| Registry | Lives in | Holds |
|---|---|---|
| Logical | `src/data/config/game/**` | pure gameplay data (stats, rates, refs) |
| Visual (VSM) | `src/data/visual-config/**` | what the renderer draws (thin/opt-in here) |
| UI | `src/data/config/ui/**` | presentation (name/colour/icon) |
| Assets | `assets/**/assets.json` + `aliases.json` | the asset database (id → art, never a path) |
| Account | `src/account` | the six-section economy blob (`@bishop/meta-contract`) |

Categories (mirroring MergeCombat): **key-kind** `chains` `generators` `rarities` `gearSlots`;
**id-kind** `resources` (the id-keyed wallet) `heroes` `enemies` `gearPieces` `zones` `banners`;
**singletons** `battle` `energy` `progression`.

### Authoring

```bash
npm run scaffold -- config fields <cat>        # the schema as a field table (authoring contract)
npm run scaffold -- config expand <id>         # an entry with its refs inlined
npm run scaffold -- config create <cat> --name <slug>   # scaffold one entry, then edit the JSON
npm run game-config:validate                    # cross-entity ref integrity (also visual/assets:validate)
```

Edit the JSON directly — the blocking PreToolUse hook (`config/validate-edit-hook.mjs`) re-validates
every write against the same Zod schema the build uses. `registry ∈ config | visual | assets`.

## What's vendored

`packages/bishop/*` are the real `@bishop/*` engine packages (config-registry, asset-registry,
asset-types-2d, asset-processors, render-contract, meta-contract, meta-client), copied from
`bishop-packages` and built via `npm run build:packages`. Upstream ships them as a git submodule; this
project vendors them so it builds self-contained. `meta-engine` (the server backend) is intentionally
not included — the account is local until the economy ports to a server (a wiring change).

## Architecture

`CLAUDE.md` (rules + data-layer conventions) · `ARCHITECTURE.md` (the framework contract) ·
`COMMANDS.md` (command reference) · each module folder carries a `README.md`.
