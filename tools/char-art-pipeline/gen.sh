#!/usr/bin/env bash
# === rpg-characters gen driver (v14 — batch/TSV) ===
# Reads classes.tsv (slug<TAB>subject) and generates each in the locked style via Fortis
# (Gemini 2.5 Flash Image), anchored to the Mage proportion master. NO VFX. UNTRIMMED white bg.
# Idempotent: skips a class if <OUT>/<slug>.png already exists (default OUT=trim/assets/heroes; FORCE=1 to regen).
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
REF="$ROOT/reference/proportion_master.png,$ROOT/reference/hair_ref_f.png,$ROOT/reference/hair_ref_m.png"
GEN="$ROOT/gen-image-fortis-ref.sh"
CONC="${CONC:-8}"
FORCE="${FORCE:-0}"
# Staging target = the TRIM tool's heroes input (was final/). Override with OUT=/path.
OUT="${OUT:-$ROOT/trim/assets/heroes}"
mkdir -p "$ROOT/raw" "$ROOT/logs" "$OUT"

STYLE="Full-body single fantasy RPG character, drawn as one of a matching set. PROPORTION — THE SINGLE MOST IMPORTANT RULE: copy the body proportions of the FIRST reference image (the PROPORTION MASTER) EXACTLY — the same large head relative to the body, the same 2.5-heads-tall chibi build with the head at the top ~40% of the total height, the same limb and torso length. Measure height from the TOP OF THE HEAD to the FEET; long flowing hair does NOT add to height. Every character MUST share this identical proportion and overall size — never taller, never a smaller head, never more slender than the master. Keep the whole body visible from head to feet. Render the character in a DYNAMIC ACTION POSE — mid-combat with energy and movement. FACE (most important) — a clean stylized face with the SAME uniform eye structure on every character: large expressive almond anime eyes, a bold upper-eyelid line, strong defined eyebrows, colored iris with a bright highlight (iris colour varies per class); EVERY character looks FOCUSED, intense and READY FOR COMBAT (serious, not smiling). SKIN — a PALE, soft peachy skin tone rendered with SUBSURFACE SCATTERING: soft translucent luminous skin with subtle warm translucency at the edges, smooth soft gradients and a gentle blush; soft and painterly even though the armor stays flat cel-shaded. HAIR — a NORMAL, STANDARD, natural hairstyle (NO wild anime spikes, NO Dragon Ball spikes), rendered as a few LARGE, BOLD, CHUNKY faceted locks with crisp edges and a bold highlight on each chunk, carrying a smooth ROOT-TO-TIP gradient in light, saturated, vivid colours. COLOUR — a RICH, DEEP, SATURATED palette. OUTLINES — a THICK BLACK OUTER contour, but every INNER line inside the silhouette drawn in a DARKER shade of the LOCAL colour it borders (coloured line-art), NOT black. FLAT cel-shading on armor and clothing. BODY — on the compact chibi frame keep adult physiques: WOMEN attractive in REVEALING combat outfits, MEN broad and muscular with a strong jaw. COSTUME — EXTREMELY ORNATE, intricate, layered, richly detailed in the HONKAI IMPACT / HoYoverse style: elaborate gold filigree, engraved metal trim, layered fabric and sashes, straps, buckles, gemstones, tassels and flowing accents — never plain. IMPORTANT — NO visual effects of any kind: no magic aura, no glowing energy, no particles, no sparkles, no light bursts, no smoke, no swirls, no motion streaks; render ONLY the character and their equipment (effects are added later in post). Centered, isolated on a plain flat solid white background. No text, no watermark, no QR code, no logo. Subject: "

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
  # OVERRIDES = critical elements that outrank the base style (e.g. "lava skin, cornrow hair")
  [ -n "${OVERRIDES:-}" ] && prompt="${prompt} — CRITICAL OVERRIDES (ABSOLUTE priority over any conflicting detail above; they REPLACE the base defaults where they conflict): ${OVERRIDES}."
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
