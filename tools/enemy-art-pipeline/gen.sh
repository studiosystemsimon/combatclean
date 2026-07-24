#!/usr/bin/env bash
# === ENEMY art gen driver (batch/TSV) ===
# Reads classes.tsv (slug<TAB>subject) and generates each ENEMY in the locked enemy style via Fortis
# (Gemini 2.5 Flash Image), anchored to the enemy style reference. NO VFX. UNTRIMMED white bg.
# Output goes to the SHARED trim tool's `enemies` category (../char-art-pipeline/trim/assets/enemies).
# Idempotent: skips a slug if <OUT>/<slug>.png already exists (FORCE=1 to regen).
# Per-class retry for NO_IMAGE (missing output) and for a black background (wants white).
# Concurrency capped so the gateway isn't hammered.
#
# Usage:
#   bash gen.sh                 # generate every class in classes.tsv missing from the OUT dir
#   FORCE=1 bash gen.sh         # regenerate all
#   bash gen.sh knight ninja    # only these slugs (still respects FORCE)
# bash 3.2 compatible.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TSV="$ROOT/classes.tsv"
REF="$ROOT/reference/enemy_color_ref.png,$ROOT/reference/enemy_style_ref.png"
GEN="$ROOT/gen-image-fortis-ref.sh"
CONC="${CONC:-8}"
FORCE="${FORCE:-0}"
# Staging target = the SHARED trim tool's `enemies` category. Override with OUT=/path.
OUT="${OUT:-$(cd "$ROOT/.." && pwd)/char-art-pipeline/trim/assets/enemies}"
mkdir -p "$ROOT/raw" "$ROOT/logs" "$OUT"

# Enemy STYLE — FORM/LINEWORK from reference/enemy_style_ref.png (loose hand-inked gritty cartoon),
# COLOUR from reference/enemy_color_ref.png (rich saturated vibrant painterly). Iterate as we dial in.
STYLE="Single fantasy MONSTER / ENEMY creature in the ZELDA: PHANTOM HOURGLASS art style, matching the FIRST reference image (the STYLE/COLOUR MASTER) closely. STYLE — clean, bold CEL-SHADING with crisp confident forms and smooth flat colour fills; a THICK dark outline; chunky, rounded, expressive character design that is charming but clearly menacing; a stocky slightly-chibi build with a large characterful head. COLOUR — RICH, SATURATED, VIBRANT hues with glossy highlights and deep shadows, exactly like the reference. CONTRAST — VERY HIGH so it pops. Keep the design BOLD and SIMPLE with a strong, instantly-readable SILHOUETTE — it appears TINY in-game, so MINIMISE busy fine detail (no tiny straps, buckles, filigree or intricate texture); use only a few big clear shapes. FACE — big, simple and menacing. Clearly a hostile enemy creature (fangs, claws, horns, glaring or glowing eyes as fitting). IMPORTANT — NO visual effects: no magic aura, glow, particles, sparkles, light bursts, smoke, swirls, flames, or motion streaks (a single small intrinsic glowing eye is fine). ONE creature only, WHOLE body visible, in a dynamic MENACING combat pose. NO ground, NO floor, NO floor texture, NO cast shadow beneath the creature, NO base or platform — the creature sits ALONE on pure empty white. Centered, isolated on a plain solid WHITE background. ABSOLUTELY NO text, NO name label, NO caption, NO signature, NO watermark, NO logo anywhere in the image. Subject: "

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
  # OVERRIDES = critical elements that outrank the base style (e.g. "lava skin, molten cracks")
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
  # best-effort: keep whatever we got even if bg not white
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
