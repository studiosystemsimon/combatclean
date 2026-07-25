#!/usr/bin/env bash
# === MERGE-ICON art gen driver (batch/TSV) ===
# Reads rosters/<chain>.tsv (slug<TAB>subject) and generates each MERGE-CHAIN ITEM ICON in the locked
# merge-icon style via Fortis (Gemini 2.5 Flash Image), ANCHORED to the exemplar images in reference/.
# UNTRIMMED white bg — the trim tool die-cuts + applies the outline treatment afterwards.
# Output → the SHARED trim tool's <chain> category (../char-art-pipeline/trim/assets/<chain>).
# Idempotent: skips a slug if <OUT>/<slug>.png already exists (FORCE=1 to regen).
# Per-slug retry for a missing output and for a black background (we want white).
#
# Usage:
#   TSV=rosters/blade.tsv OUT=../char-art-pipeline/trim/assets/blade bash gen.sh
#   FORCE=1 TSV=rosters/magic.tsv OUT=../char-art-pipeline/trim/assets/magic bash gen.sh magic-2
#   (the trim tool's Regen buttons set TSV/OUT/FORCE for you, per chain)
# bash 3.2 compatible.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TSV="${TSV:-$ROOT/rosters/blade.tsv}"     # override per chain: TSV=rosters/<chain>.tsv
GEN="$ROOT/gen-image-fortis-ref.sh"
CONC="${CONC:-6}"
FORCE="${FORCE:-0}"
# Staging target = the SHARED trim tool's <chain> category. Override with OUT=/path.
OUT="${OUT:-$(cd "$ROOT/.." && pwd)/char-art-pipeline/trim/assets/blade}"
mkdir -p "$ROOT/raw" "$ROOT/logs" "$OUT"

# ANCHOR resolution — ONE canonical reference per chain, so every tile in a chain stays consistent
# with the SAME image (no drift). Priority:
#   1. REF=<path[,path]> env      → forced anchor for this run
#   2. reference/anchor-<cat>.png  → this chain's canonical anchor (cat = the OUT folder name)
#   3. reference/style-sheet.png   → fresh chain with no anchor yet (establishes the look)
CAT="$(basename "$OUT")"
if [ -z "${REF:-}" ]; then
  if   [ -f "$ROOT/reference/anchor-$CAT.png" ]; then REF="$ROOT/reference/anchor-$CAT.png"
  elif [ -f "$ROOT/reference/style-sheet.png" ]; then REF="$ROOT/reference/style-sheet.png"
  else REF="$(ls "$ROOT"/reference/*.png 2>/dev/null | grep -v '/anchor-' | paste -sd, -)"; fi
fi
if [ -z "$REF" ]; then
  echo "No anchor for '$CAT' — add $ROOT/reference/anchor-$CAT.png (or reference/style-sheet.png)." >&2
  exit 1
fi

# MERGE-ICON STYLE — PRIMARY weapon + matching COMPANION cluster (per-tier subject names both), gentle 3/4, fills the square, NO shadow. Anchored to reference/style-sheet.png.
STYLE="A single video-game merge-chain item icon. Rendering: painterly hand-painted look like the reference — soft cel-shading (smooth gradients PLUS crisp highlights), a soft dark PAINTED outline hugging the form, one warm light source from the TOP-LEFT. PROPORTIONS: bold and weighty — a broad blade and a WIDE guard, substantial, NOT thin/elegant and NOT chibi-stubby. COMPOSITION — a PERFECTLY SQUARE 1:1 image showing the item(s) named in the subject, composed to FILL the square (about 90% of the frame, only a small even margin, no large empty areas), at a natural GENTLE 3/4 view with only MILD perspective (no extreme or exaggerated foreshortening). IF THE SUBJECT NAMES A SINGLE ITEM: present that ONE object large and centered, filling the square. IF THE SUBJECT NAMES TWO ITEMS (a primary weapon + a companion): arrange them as ONE compact cluster — the COMPANION large and slightly BEHIND (filling most of the square), the PRIMARY weapon fully IN FRONT crossing diagonally (handle/grip end toward the lower-left, far end toward the upper-right), the two reading as SEPARATE objects with a clear outline and depth separation, never blended or merged. All named items share the SAME material, palette and theme for this tier; silhouettes shift on the later tiers as the subject specifies. ABSOLUTELY NO shadow, NO drop shadow, NO cast shadow, NO floor, NO ground, NO base, NO pedestal, nothing beneath the objects. Only the named item(s), nothing else. Keep a LIMITED, cohesive colour palette — a dominant hue family plus wood / metal neutrals, NOT every colour. Effects (glow, embers, runes) ONLY where the subject calls for them, restrained and intrinsic to the item. NO character, NO hands, NO arm, NO creature, NO scene. NO white sticker / die-cut border. NO text, name label, caption, signature, watermark or logo. Isolated on a solid FLAT PURE-WHITE background. Subject: "

corner_light() {  # $1 = png ; echoes LIGHT or DARK/MISS
  python3 - "$1" <<'PY' 2>/dev/null || echo MISS
import sys; from PIL import Image
im=Image.open(sys.argv[1]).convert("RGB"); w,h=im.size
pts=[im.getpixel((3,3)),im.getpixel((w-4,3)),im.getpixel((3,h-4)),im.getpixel((w-4,h-4))]
print("LIGHT" if sum(sum(p) for p in pts)/12>200 else "DARK")
PY
}

gen_one() {  # $1=slug  $2=subject
  local slug="$1" subj="$2" prompt="${STYLE}${2}" t st
  # OVERRIDES = critical elements that outrank the base style (e.g. "runic engraving, twin blades")
  [ -n "${OVERRIDES:-}" ] && prompt="${prompt} — CRITICAL OVERRIDES (ABSOLUTE priority over any conflicting detail above; they REPLACE the base defaults where they conflict): ${OVERRIDES}."
  for t in 1 2 3 4; do
    rm -f "$ROOT/raw/$slug.png"
    SKIP_SHRINK=1 "$GEN" "$ROOT/raw/$slug.png" "$prompt" "$REF" > "$ROOT/logs/$slug.log" 2>&1 || true
    if [ -f "$ROOT/raw/$slug.png" ]; then
      st="$(corner_light "$ROOT/raw/$slug.png")"
      # keep unless the bg is genuinely DARK; LIGHT or an un-checkable MISS are both fine (no wasted retries)
      if [ "$st" != "DARK" ]; then cp "$ROOT/raw/$slug.png" "$OUT/$slug.png"; echo "OK   $slug ($st)"; return 0; fi
      echo "  ..$slug try $t bg=DARK, retrying"
    else
      echo "  ..$slug try $t NO_IMAGE, retrying"
    fi
    sleep 2
  done
  if [ -f "$ROOT/raw/$slug.png" ]; then cp "$ROOT/raw/$slug.png" "$OUT/$slug.png"; echo "WARN $slug (kept non-white bg)"; return 0; fi
  echo "FAIL $slug"; return 1
}

# Build worklist (respect explicit slug args, skip existing unless FORCE)
declare_args="$*"
want() { [ -z "$declare_args" ] && return 0; for a in $declare_args; do [ "$a" = "$1" ] && return 0; done; return 1; }

running=0; total=0
while IFS=$'\t' read -r slug subject; do
  [ -z "${slug:-}" ] && continue
  case "$slug" in \#*) continue;; esac
  want "$slug" || continue
  if [ "$FORCE" != "1" ] && [ -f "$OUT/$slug.png" ]; then echo "skip $slug (exists)"; continue; fi
  gen_one "$slug" "$subject" &
  running=$((running+1)); total=$((total+1))
  if [ "$running" -ge "$CONC" ]; then wait; running=0; fi
done < "$TSV"
wait
echo "=== batch done: attempted $total ==="
echo "output count: $(ls "$OUT"/*.png 2>/dev/null | grep -vE '_(trim|256)\.png$' | wc -l | tr -d ' ')  -> $OUT"
