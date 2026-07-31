# char-art trim stage

The operator-driven **transparency / trimming** stage of the character-art pipeline. The generator
(`../gen.sh`) delivers **untrimmed, flat-white-background** art. This tool turns those into
transparent **die-cut halo** assets (and square exports) procedurally through Photoshop.

It is a standalone click tool: you drop points only where an asset needs an **internal fill removed**,
save that as metadata, and the Photoshop step runs off the metadata. **0 points = default trim.**

## Launch
- Double-click **`TrimTool.app`** (first run: right-click → Open to clear Gatekeeper), or
- `bash launch_tool.sh` — opens <http://localhost:8790>.

Requires Adobe Photoshop 2022 and `/usr/bin/python3` (server is stdlib-only). First **Clip** may ask
permission to control Photoshop — approve once.

## Folder structure
```
trim/
  assets/            <- drop white-bg source PNGs here, by category
    heroes/          <- heroes ALSO get a 256×256 square export (see below)
    enemies/
    icons/
    …                <- any new subfolder becomes a category automatically
  asset_tool.html    <- the click UI
  asset_tool_server.py
  trim.jsx           <- the Photoshop script (fit → outside-trim → pockets → square export)
  launch_tool.sh
  TrimTool.app
```
Outputs are written **alongside each source** in its category folder:
- `<name>_trim.png` — transparent die-cut with the halo border
- `<name>_256.png` — square export (categories in `EXPORT_SIZES`; heroes → 256)
- `<name>_<sz>_shadow.png` — **separate baked drop-shadow layer** (merge chains only), on the SAME
  `sz×sz` canvas as the sprite so the game's `mergeStyle` reg/scale/rotation transform lands it
  exactly behind the icon. A static replacement for the per-tile CSS `filter: drop-shadow`. Params
  (blur / dx / dy / opacity / colour, in 256-src px) live in `trim_meta.json`'s `shadow` block —
  tuned to parity in `docs/mockups/merge-shadow-parity.html`. Set `shadow.enabled:false` to skip.

## Using it
1. Pick an asset in the left list (grouped by category).
2. In **Source** view, click inside any enclosed background pocket to cut out (e.g. a bow window).
   Most assets need **no** points.
3. Set the **Halo** width (universal — applies to the outer die-cut and internal cutouts).
4. **Clip current** (this asset) or **Clip all**. The view flips to **Trimmed** so you see the result;
   use the **Trimmed / 256** toggle to inspect the die-cut and the square export on a checkerboard.

## The pipeline steps (`trim.jsx`)
- **A. Fit-to-frame** — if the subject is within 14px of an edge, scale it down (aspect-preserving)
  and re-center so the halo never clips.
- **B. Trim** — contiguous magic-wand of the outside white → contract by the halo width → delete.
- **C. Pockets** — each clicked point (mapped through the fit transform) → contiguous wand → contract
  → delete, cutting enclosed background fills.
- **D. Square export** — for categories in `EXPORT_SIZES` (heroes → 256): trim to content, then
  Photoshop **Image Size** scale to fit and center on a transparent `size × size` canvas.

Knobs live at the top of `trim.jsx` (`CONTRACT_PX`, `MIN_MARGIN`, `TOLERANCE`, `EXPORT_SIZES`).
Originals are never overwritten.
