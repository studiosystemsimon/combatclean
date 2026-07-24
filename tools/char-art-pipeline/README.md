# combatclean character-art pipeline

A faithful port of the `rpg-characters` generation pipeline. **RAW CHARACTER GENERATION ONLY — no
animation.** Produces one untrimmed, flat-white-background character PNG per class in the operator's
locked chibi style, staged in `final/`. Owned by the `hero-art-pipeline` subagent
(`.claude/agents/hero-art-pipeline.md`).

## Requirements
- `fortis-ai-gateway` logged in (`fortis-ai-gateway status` → OK). Generation runs on
  **Gemini 2.5 Flash Image (nano-banana) via the Fortis gateway** — never flux2.
- `python3` + Pillow (`PIL`).

## Files
| File | Role |
|---|---|
| `gen.sh` | Batch driver. Reads `classes.tsv`, prepends the **locked STYLE prefix** (in its header), generates each class. Idempotent, concurrency-capped, auto-retries `NO_IMAGE` + black-bg. |
| `gen-image-fortis-ref.sh` | Low-level Gemini-endpoint wrapper (multi-reference, comma-separated). Self-contained copy — no dependency on the froggame repo. |
| `classes.tsv` | The roster: `<slug>⇥<subject>`. A subject describes **only** gender / hair-colour gradient / costume / weapon / pose. **Style is NOT restated here** — it lives in `gen.sh`'s header. |
| `reference/` | The style anchors (**do not delete**). |
| `sheet.py` | Builds `contact_sheet.png` from `final/` for review. |

### reference/ anchors
- `proportion_master.png` — **THE proportion + style master** (the "mage"). Every gen anchors to
  this so all characters share an identical head:body ratio. Load-bearing.
- `hair_ref_f.png` / `hair_ref_m.png` — chunky faceted hair references.
- `anchor3.png` — original anime-chibi / peachy-skin anchor.

## Usage
```bash
cd tools/char-art-pipeline
bash gen.sh                 # generate every class in classes.tsv missing from final/
bash gen.sh knight wizard   # only these slugs
FORCE=1 bash gen.sh         # regenerate all (overwrite final/)
python3 sheet.py            # rebuild contact_sheet.png for review
```
Output: `final/<slug>.png` — ~1024px, **flat white background, UNTRIMMED**.

## Delivery conventions (operator hard rules)
- **NO VFX** in the art (no auras / glow / particles / energy). VFX is added later in post.
- **Do NOT trim, crop, or make transparent** — deliver untrimmed on a flat white bg. The operator
  does transparency/trimming.
- **Idempotent** — `gen.sh` skips a class already present in `final/` unless `FORCE=1`.

## The locked style (summary — full text is the `STYLE=` block in `gen.sh`)
2:3 head:body chibi (2.5 heads) · thick **black outer outline**, inner lines = a darker shade of the
local colour (coloured line-art) · **standard hairstyles** as chunky faceted locks with a
**root→tip light saturated gradient** · pale peachy **subsurface-scattering** skin · focused
combat-ready faces + uniform eye structure · **Honkai-Impact-rich** ornate layered costumes · women
in revealing combat outfits, men broad/muscular · dynamic action poses.

## Adding / editing a class
Add or edit a row in `classes.tsv`: `slug⇥subject` (tab-separated). Keep the subject to
gender + hair-colour gradient + costume + weapon + pose. Then `bash gen.sh <slug>` (or delete
`final/<slug>.png` / use `FORCE=1`) to regenerate.

## combatclean integration (separate, operator-driven)
Hero configs live in `src/data/config/game/heroes/*.json`; hero **art** belongs under
`assets/combatclean/heroes/` (surfaced via the Visual registry + `virtual:asset-registry`). This
pipeline **only STAGES art in `final/`**. Wiring staged art into the game's asset registry is a
separate change that must go through combatclean's changeset workflow — this pipeline never edits
game code or registries.

## Do NOT
- Do **not** use froggame's `scripts/sheets/gen-styled-sheet-diffusion.sh` — it hard-locks a frog
  flat-vector navy style (and frog post-processing) that destroys this look.
