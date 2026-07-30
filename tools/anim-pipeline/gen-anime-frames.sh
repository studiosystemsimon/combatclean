#!/usr/bin/env bash
# Rich per-frame ANIME flat flame frames. The ORB is described identically every frame (and locked in
# post by static-orb composite); only the FLAME changes richly. Stable iridescent palette, no white streaks.
set -uo pipefail
cd "$(dirname "$0")"
ANCHOR="soul-anime.png"
mkdir -p aframes
COMMON="Clean ANIME flat-cel VFX sticker of a magical soul-flame orb. The ORB is IDENTICAL in every image: a round orb with a bright near-white core, a clean dark outline, and FLAT iridescent colour bands (violet, magenta, cyan, teal) — same size, centred in the LOWER HALF. Above the orb the FLAME does this: "
TAIL=". FLAT cel colours only, iridescent VIOLET / MAGENTA / CYAN / TEAL matching the orb (NO white flame streaks, NO yellow-green, NO photographic gradients, NO oil-slick), crisp clean dark outline, bold simple anime shapes. Plain solid WHITE background, single centred object."

FLAME=(
"a single tall flame tongue rises straight up, its tip curling slightly"
"two flame tongues — one tall, one small — lick upward together"
"the flame leans LEFT, its tip whipping, a small spark separating off"
"a broad wavy flame with several small licks along its length"
"the flame curls into a rising S-shape"
"the flame leans RIGHT, a spark flicking off the tip"
"a tall thin flame with a hooked, curling tip"
"the flame splits into THREE small rising tongues"
"a swirled flame curling over at the very top"
"a low broad flame with several stubby licks"
"the flame rises as a spiralling wisp with a spark above it"
"a tall flame tongue whipping LEFT, tip curling (about to loop back to the first)"
)

for i in $(seq 1 12); do
  n=$(printf "%02d" "$i")
  SKIP_SHRINK=1 ./gen-image-fortis.sh --reference-image "$ANCHOR" "aframes/af-$n.png" \
    "${COMMON}${FLAME[$((i-1))]}${TAIL}" > "aframes/af-$n.log" 2>&1 &
done
wait
echo "=== $(ls aframes/*.png 2>/dev/null | wc -l | tr -d ' ') rich flame frames ==="
