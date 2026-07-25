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

# REF = every image in reference/ (comma-joined). Drop your merge-icon exemplars there to lock the style.
REF="$(ls "$ROOT"/reference/*.png 2>/dev/null | paste -sd, -)"
if [ -z "$REF" ]; then
  echo "No reference images in $ROOT/reference/ — add your merge-icon exemplar PNG(s) there first (the style is anchored to them)." >&2
  exit 1
fi

# MERGE-ICON STYLE — DRAFT (we iterate this with the reference images). A single game ITEM icon.
STYLE="A single video-game MERGE-CHAIN ITEM ICON, drawn in ONE consistent house style matching the reference exemplar image(s) EXACTLY — the SAME rendering technique, palette, outline weight, shading and finish; it must look like the same artist made it for the same game set. ONE item only (the weapon / implement appropriate to its chain), CENTERED and filling the frame, as a bold clean icon with a THICK even dark contour outline and smooth flat CEL-SHADING (NOT painterly, NOT airbrushed, NOT sketchy), crisp highlights and deep shadows, HIGH CONTRAST and a strong readable SILHOUETTE (it appears small in-game, so keep detail bold and clear). NO character, NO hands, NO arm, NO creature. NO background scene. NO visual effects — no glow, aura, sparkles, particles, smoke or motion streaks — unless the light is intrinsic to the item (e.g. a glowing gem). NO ground, floor, cast shadow or base. Centered, isolated on solid WHITE. ABSOLUTELY NO text, name label, caption, signature, watermark or logo. Subject: "

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
