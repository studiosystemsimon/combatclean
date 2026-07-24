# enemy-art-pipeline — ENEMY generation

A **generation-only** duplicate of the hero pipeline. It generates untrimmed, flat-white-background
**enemy** art via Fortis (Gemini 2.5 Flash Image), staged straight into the **shared** trim tool's
`enemies` category — the SAME app you use for heroes.

- Roster: `classes.tsv` (`<slug>⇥<subject>`; subject = the creature only, style is locked in `gen.sh`).
- Style anchors: `reference/enemy_style_ref.png` (+ `enemy_anchor.png`), copied from the game's enemy art.
- Output: `../char-art-pipeline/trim/assets/enemies/<slug>.png` (override with `OUT=`).

## Usage
```bash
cd tools/enemy-art-pipeline
bash gen.sh                 # generate every enemy in classes.tsv missing from the shared enemies folder
bash gen.sh slime bat       # only these slugs
FORCE=1 bash gen.sh         # regenerate all
python3 sheet.py            # contact sheet of the generated enemies
```
Then open the **shared** trim tool (`../char-art-pipeline/trim` — TrimTool.app), pick the **enemies**
category, and trim / set registry points / clip / export as usual.

## Still to do (operator)
- **Lock the enemy STYLE** in `gen.sh` (the `STYLE=` block is a DRAFT anchored to the game's enemy art).
- **Fill `classes.tsv`** with the enemy roster.
- The shared tool's **export-to-game** currently targets the hero config; wiring the `enemies` category
  to the enemy config (`src/data/config/game/enemies` + `ui/enemies` + `enemy.<slug>` assets, id lane
  3000s, fields `hpMul`/`atkMul`/`boss`) is a separate step when you're ready.
