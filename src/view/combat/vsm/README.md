# vsm — Visual State Machine (the visual registry)

**Invariants**
- The SECOND leg of the id-contract: a visual entry is keyed by the SAME numeric id as its logical
  entry (`src/data/config/game/<cat>/<id>-*.json` ↔ `src/data/visual-config/<cat>/<id>.json`).
- Holds ONLY what the renderer draws (states → layers → keyframes). NO gameplay data, NO UI text.
- Assets are referenced by `*AssetId` (an asset-registry id), never a path. Colours are linear
  `[r,g,b,a]` tuples, never hex.
- `schema.ts` is the single source of the visual-config shape — the build compose, the `visual`
  scaffold registry, and the edit hook all validate against it.
- Runtime code imports ONLY the inferred TYPE from `schema.ts` (`import type`) so zod never enters
  the browser bundle.

**Opt-in (combatclean)** — this layer is intentionally THIN. combatclean's shipped visuals are the
ASSET REGISTRY (MergeCombat-style key→art, resolved by id). An entity with no visual entry returns
`undefined` from `getVisualConfig(id)` and the caller falls back to its asset. The VSM is present as
the contract for when animated combat visuals are added.
