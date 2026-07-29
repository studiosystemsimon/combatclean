#!/usr/bin/env bash
# === GEAR art gen driver (batch/TSV) ===
# Reads rosters/<category>.tsv (slug<TAB>subject) and generates each GEAR ITEM ICON in the locked gear
# style via Fortis (Gemini 2.5 Flash Image), ANCHORED to the exemplar images in reference/.
# Categories: armor / weapons / accessories. Item slug convention: <subcategory>-<rarity>
#   e.g. helm-common, chestplate-rare, longsword-legendary, ring-epic  (rarity = last token, groups the list).
# UNTRIMMED white bg — the trim tool die-cuts + applies the outline treatment afterwards.
# Output → the SHARED trim tool's <category> folder (../char-art-pipeline/trim/assets/<category>).
# Idempotent: skips a slug if <OUT>/<slug>.png already exists (FORCE=1 to regen).
# Per-slug retry for a missing output and for a black background (we want white).
#
# Usage:
#   TSV=rosters/armor.tsv OUT=../char-art-pipeline/trim/assets/armor bash gen.sh
#   FORCE=1 TSV=rosters/weapons.tsv OUT=../char-art-pipeline/trim/assets/weapons bash gen.sh longsword-rare
#   (the trim tool's Regen buttons set TSV/OUT/FORCE for you, per category)
# bash 3.2 compatible.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TSV="${TSV:-$ROOT/rosters/armor.tsv}"     # override per category: TSV=rosters/<category>.tsv
GEN="$ROOT/gen-image-fortis-ref.sh"
CONC="${CONC:-6}"
FORCE="${FORCE:-0}"
# Staging target = the SHARED trim tool's <category> folder. Override with OUT=/path.
OUT="${OUT:-$(cd "$ROOT/.." && pwd)/char-art-pipeline/trim/assets/armor}"
mkdir -p "$ROOT/raw" "$ROOT/logs" "$OUT"

# ANCHOR resolution — reference exemplar(s) that lock the gear style. Priority:
#   1. REF=<path[,path]> env         → forced anchor for this run (e.g. a subcategory reference)
#   2. reference/anchor-<category>.png → this category's canonical anchor (cat = the OUT folder name)
#   3. reference/style-sheet.png     → fresh category with no anchor yet (establishes the look)
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

# GEAR STYLE — POLISHED glossy anime/JRPG finish (matches the hero character sprites). Clean heroic high-fantasy gear. ONE item, fills square, NO shadow, rarity drives ornamentation. NO tribal.
STYLE="A single video-game GEAR item icon rendered in a POLISHED, appealing glossy ANIME / JRPG style that matches a hero character sprite: clean bold cel-shading with smooth gradients and crisp highlights, a clean defined dark outline (NOT grungy, NOT rough), refined fine detailing and elegant gold/metal work, one warm light source from the TOP-LEFT, vibrant yet cohesive colours. THEME — clean HEROIC HIGH-FANTASY adventurer gear (knightly, elegant, storybook). ABSOLUTELY NO tribal, primitive, tiki, bone, driftwood or shark motifs of any kind. COMPOSITION — a PERFECTLY SQUARE 1:1 image of the SINGLE item named in the subject, large and centered, filling about 88% of the frame at a natural GENTLE 3/4 view with only MILD perspective. The item's material and ornamentation MUST reflect its RARITY as the subject specifies — humble worn iron/leather/cloth at low rarity, polished steel/silver with fine trim at mid rarity, ornate GOLD with gems, engraving and a subtle magical glow at high rarity. ABSOLUTELY NO shadow, NO ground, NO base, nothing beneath the item — just the ONE item. NO character, NO hands, NO arm, NO body, NO creature, NO face, NO scene. NO white sticker / die-cut border. NO text, name label, caption, signature, watermark or logo. Isolated on a solid FLAT PURE-WHITE background. Subject: "

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
