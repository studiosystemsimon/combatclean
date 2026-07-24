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
TSV="${TSV:-$ROOT/classes.tsv}"   # override with TSV=rosters/<area>.tsv for per-area generation
REF="$ROOT/reference/enemy_ref_a.png,$ROOT/reference/enemy_ref_b.png"
GEN="$ROOT/gen-image-fortis-ref.sh"
CONC="${CONC:-8}"
FORCE="${FORCE:-0}"
# Staging target = the SHARED trim tool's `enemies` category. Override with OUT=/path.
OUT="${OUT:-$(cd "$ROOT/.." && pwd)/char-art-pipeline/trim/assets/enemies}"
mkdir -p "$ROOT/raw" "$ROOT/logs" "$OUT"

# Enemy STYLE — FORM/LINEWORK from reference/enemy_style_ref.png (loose hand-inked gritty cartoon),
# COLOUR from reference/enemy_color_ref.png (rich saturated vibrant painterly). Iterate as we dial in.
STYLE="Single fantasy MONSTER / ENEMY creature drawn in ONE consistent house style, matching the TWO reference exemplar images EXACTLY. CONSISTENCY IS THE #1 RULE — it MUST look like it was drawn by the SAME artist for the SAME game set as the references: the SAME clean, bold, flat CEL-SHADING (smooth flat colour fills, NOT painterly, NOT rendered/airbrushed, NOT sketchy), the SAME even THICK dark ink outline of consistent weight, the SAME crisp finish, the SAME level of detail, and the SAME stocky slightly-chibi proportions with a large characterful head and short sturdy limbs. Do NOT invent a different rendering style. Match the exemplars' technique precisely; only the creature's shape and colour change. COLOUR — colour it to suit its own nature (biome-appropriate hues), RICH, SATURATED and HIGH-CONTRAST with clean cel highlights and deep shadows like the references. Keep the design BOLD and SIMPLE with a strong readable SILHOUETTE — it appears TINY in-game, so MINIMISE busy fine detail; a few big clear shapes only. FACE — big, simple, menacing. IMPORTANT — NO visual effects: no aura, glow, particles, sparkles, light bursts, smoke, swirls, flames, or motion streaks (a single small intrinsic glowing eye or molten crack is fine). ONE creature only, WHOLE body visible, dynamic MENACING pose. NO ground, floor, floor texture, cast shadow or base — ALONE on pure empty white. Centered, isolated on solid WHITE. ABSOLUTELY NO text, name label, caption, signature, watermark or logo. Subject: "

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
