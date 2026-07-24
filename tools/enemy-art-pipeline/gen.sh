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
REF="$ROOT/reference/enemy_style_ref.png,$ROOT/reference/enemy_anchor.png"
GEN="$ROOT/gen-image-fortis-ref.sh"
CONC="${CONC:-8}"
FORCE="${FORCE:-0}"
# Staging target = the SHARED trim tool's `enemies` category. Override with OUT=/path.
OUT="${OUT:-$(cd "$ROOT/.." && pwd)/char-art-pipeline/trim/assets/enemies}"
mkdir -p "$ROOT/raw" "$ROOT/logs" "$OUT"

# TODO(operator): DRAFT enemy style — refine + lock this like the hero STYLE was locked. It anchors to
# reference/enemy_style_ref.png (the game's existing enemy art style). Adjust wording once you're happy.
STYLE="Single fantasy MONSTER / CREATURE enemy, drawn as one of a matching set. STYLE — match the FIRST reference image (the ENEMY STYLE MASTER) EXACTLY: the same chibi-creature proportions, the same rendering treatment, the same overall size and framing; every enemy MUST share this identical style and scale. Keep the whole creature visible. Render it in a DYNAMIC, MENACING combat pose — mid-attack, hostile and full of energy. FORM — a bold, readable chibi monster silhouette with large expressive features; clearly a threatening enemy creature (fangs, claws, horns, spines, glaring eyes as the subject calls for). COLOUR — a RICH, DEEP, SATURATED palette. OUTLINES — a THICK BLACK OUTER contour, but every INNER line drawn in a DARKER shade of the LOCAL colour it borders (coloured line-art), NOT black. FLAT cel-shading. IMPORTANT — NO visual effects of any kind: no aura, glow, particles, sparkles, light bursts, smoke, swirls, or motion streaks; render ONLY the creature (effects are added later in post). Centered, isolated on a plain flat solid white background. No text, no watermark, no QR code, no logo. Subject: "

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
  for t in 1 2 3 4; do
    rm -f "$ROOT/raw/$slug.png"
    SKIP_SHRINK=1 "$GEN" "$ROOT/raw/$slug.png" "$prompt" "$REF" > "$ROOT/logs/$slug.log" 2>&1 || true
    if [ -f "$ROOT/raw/$slug.png" ]; then
      st="$(corner_light "$ROOT/raw/$slug.png")"
      if [ "$st" = "LIGHT" ]; then cp "$ROOT/raw/$slug.png" "$OUT/$slug.png"; echo "OK   $slug"; return 0; fi
      echo "  ..$slug try $t bg=$st, retrying"
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
