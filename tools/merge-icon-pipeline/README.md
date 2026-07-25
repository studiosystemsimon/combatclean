# merge-icon-pipeline

Generates **merge-chain item icons** for the char-art trim tool, mirroring `enemy-art-pipeline`.
Three chains: **magic**, **blade**, **range**. Each roster is a tier ladder (tier 1 → N) obeying the
three cardinal laws: **clear differentiation**, **clear escalation**, **rising power & sophistication**.

## Layout
- `gen.sh` — batch driver. Reads `rosters/<chain>.tsv` (`slug<TAB>subject`), generates each icon via
  the Fortis gateway (Gemini 2.5 Flash Image), anchored to `reference/*.png`, on a WHITE background,
  and stages it into the shared tool at `../char-art-pipeline/trim/assets/<chain>/<slug>.png`.
- `gen-image-fortis-ref.sh` — the reference-anchored Fortis call (copied from the enemy pipeline).
- `rosters/{magic,blade,range}.tsv` — the tier ladders (PLACEHOLDER — iterate).
- `reference/` — **drop your merge-icon exemplar PNG(s) here**; the style is anchored to them.
- `raw/`, `logs/` — per-slug scratch + logs.

## Terminal passes (dial in the style with references)
```
# 1. put exemplar image(s) in reference/
# 2. run one chain (FORCE re-generates existing):
FORCE=1 TSV=rosters/blade.tsv OUT=../char-art-pipeline/trim/assets/blade bash gen.sh
# or a single tier while iterating:
FORCE=1 TSV=rosters/magic.tsv OUT=../char-art-pipeline/trim/assets/magic bash gen.sh magic-3
```
Then view/trim/export in the tool (group **Merge Icons** → chain subtab). The `STYLE` prompt block in
`gen.sh` is a DRAFT — we refine it against the reference images.

## Notes
- WHITE bg is deliberate: the trim tool die-cuts it to transparent and applies the outline treatment.
- The tool's per-chain **⟳** and **Regen checked** buttons drive this pipeline (route by category).
- Game export for merge icons is **not wired yet** (generation + iteration first).
