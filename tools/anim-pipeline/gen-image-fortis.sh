#!/usr/bin/env bash
# === gen-image-fortis.sh ===
#
# Route image generation through the Fortis AI gateway (Gemini 2.5 Flash Image
# = "nano-banana"). This is the PROJECT-SANCTIONED path for image generation
# because the `mcp__nano-banana__generate_image` tool requires a personal
# GEMINI_API_KEY that nobody at Fortis has — but the gateway already brokers
# Vertex AI access using `fortis-ai-gateway token`.
#
# === Usage ===
#
#   scripts/gen-image-fortis.sh [--reference-image <path>]... <out-path> "<prompt>" [target-size]
#
# target-size defaults to 256. The script always resizes Gemini's output (which
# is natively 1024 px regardless of prompted dimensions) DOWN to target-size,
# preserving alpha. Resize uses `sips` (built into macOS).
#
# --reference-image <path> (v0.45.3): pass one or more reference images as
#   style anchors. Each is base64-encoded and prepended as an inlineData part
#   in the Gemini request, BEFORE the text prompt — the canonical style-anchor
#   pattern for Gemini 2.5 Flash Image. Repeat the flag for multiple refs
#   (typical: 1-4). Supported MIME types: PNG, JPEG, WEBP (sniffed from
#   the file's magic bytes; falls back to image/png).
#
# Examples:
#   scripts/gen-image-fortis.sh assets/minibosses/slugking/idle.png \
#     "Cel-shaded sprite of a slug king with golden crown, transparent BG" 256
#
#   scripts/gen-image-fortis.sh \
#     --reference-image /path/to/style-anchor-a.png \
#     --reference-image /path/to/style-anchor-b.png \
#     assets/refs/box-tile.png \
#     "A single chunky low-poly box tile, grass-green top, ochre sides" 1024
#
# === Output ===
#
# Writes a PNG to <out-path> at target-size × target-size with alpha preserved.
# Prints "OK: <out-path> <W>x<H>" on success. Non-zero on failure.
#
# === Why this exists ===
#
# 2026-05-29: user explicit rule "DON'T run flux. ALWAYS run nanobanana." +
# "Nanobanana is usable via the Fortis AI gateway, not via GEMINI_API_KEY".
# Stored in `~/.claude/projects/-Users-simonhill/memory/feedback_nano_banana_only.md`
# + project instruction `.claude/instructions/IMAGE_GEN.md`.
set -euo pipefail

# v0.45.3 — parse repeatable --reference-image flags BEFORE positional args.
# Backwards-compat: callers passing just <out> <prompt> [size] still work.
REF_IMAGES=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reference-image)
      [ -n "${2:-}" ] || { echo "FAIL: --reference-image needs a path argument" >&2; exit 2; }
      [ -f "$2" ] || { echo "FAIL: --reference-image path does not exist: $2" >&2; exit 2; }
      REF_IMAGES+=("$2")
      shift 2
      ;;
    --reference-image=*)
      _refval="${1#*=}"
      [ -f "$_refval" ] || { echo "FAIL: --reference-image path does not exist: $_refval" >&2; exit 2; }
      REF_IMAGES+=("$_refval")
      shift
      ;;
    --) shift; break ;;
    -h|--help)
      echo "usage: $0 [--reference-image <path>]... <out-path> \"<prompt>\" [target-size]" >&2
      exit 0
      ;;
    *) break ;;
  esac
done

if [ "$#" -lt 2 ]; then
  echo "usage: $0 [--reference-image <path>]... <out-path> \"<prompt>\" [target-size]" >&2
  exit 2
fi

OUT="$1"
PROMPT="$2"
SIZE="${3:-256}"

PROXY="https://vertex-ai-proxy-284250591143.us-east5.run.app/v1"
ENDPOINT="${PROXY}/projects/agentic-coding-sandbox/locations/global/publishers/google/models/gemini-2.5-flash-image:generateContent"

mkdir -p "$(dirname "$OUT")"
TMPJSON="$(mktemp -t fortis-gen.XXXX.json)"
trap 'rm -f "$TMPJSON"' EXIT

TOKEN="$(fortis-ai-gateway token)"
# v0.45.3 — build the request body in Python so we can attach reference images
# as inlineData parts before the text part. Pass the prompt + each ref path as
# separate argv entries; Python sniffs the MIME type from magic bytes and
# base64-encodes the file. Backwards-compatible: with zero refs, the body has
# the original {parts:[{text:...}]} shape.
BODY="$(python3 - "$PROMPT" "${REF_IMAGES[@]:-}" <<'PYEOF'
import json, sys, base64, pathlib
prompt = sys.argv[1]
ref_paths = [p for p in sys.argv[2:] if p]  # filter blanks from "${ARR[@]:-}"
def sniff_mime(b):
    # PNG: 89 50 4e 47, JPEG: ff d8 ff, WEBP: 'RIFF....WEBP'
    if b[:4] == b'\x89PNG': return 'image/png'
    if b[:3] == b'\xff\xd8\xff': return 'image/jpeg'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP': return 'image/webp'
    return 'image/png'  # default
parts = []
for p in ref_paths:
    data = pathlib.Path(p).read_bytes()
    parts.append({"inlineData": {"mimeType": sniff_mime(data), "data": base64.b64encode(data).decode('ascii')}})
parts.append({"text": prompt})
print(json.dumps({"contents":[{"role":"user","parts":parts}],"generationConfig":{"responseModalities":["IMAGE"]}}))
PYEOF
)"

# Buffer the API response to a file (avoids broken-pipe issues with the
# decoder seeing partial data). Pipe $BODY via stdin to avoid "Argument list
# too long" when reference images are base64-encoded (v0.47.1 fix).
HTTP="$(printf '%s' "$BODY" | curl -sS -w '%{http_code}' -X POST "$ENDPOINT" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept-Encoding: identity" \
  --data-binary @- \
  -o "$TMPJSON")"

if [ "$HTTP" != "200" ]; then
  echo "FAIL: HTTP $HTTP from gateway. Raw response below:" >&2
  head -c 500 "$TMPJSON" >&2
  echo "" >&2
  exit 1
fi

# Decode the inline base64 PNG into <out-path>.
python3 - "$TMPJSON" "$OUT" <<'PYEOF'
import json, base64, sys, pathlib
src = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
try:
    payload = json.loads(src.read_text())
except Exception as e:
    print(f"FAIL: response was not JSON: {e}", file=sys.stderr); sys.exit(1)
try:
    parts = payload["candidates"][0]["content"]["parts"]
except (KeyError, IndexError):
    print(f"FAIL: no candidates/parts; raw={payload}", file=sys.stderr); sys.exit(1)
for p in parts:
    if "inlineData" in p and "data" in p["inlineData"]:
        out.write_bytes(base64.b64decode(p["inlineData"]["data"]))
        sys.exit(0)
print(f"FAIL: no inline image bytes; parts keys={[list(p.keys()) for p in parts]}", file=sys.stderr)
sys.exit(1)
PYEOF

# v0.5.91 — caller may set SKIP_SHRINK=1 to KEEP the raw ~1024 output so
# downstream post-process (tight_pack) can crop in high-res + single-LANCZOS
# downscale. The default sips-shrink path is retained for callers that don't
# do bbox-crop post-process.
if [ "${SKIP_SHRINK:-0}" != "1" ]; then
  sips -z "$SIZE" "$SIZE" "$OUT" >/dev/null 2>&1 || {
    echo "FAIL: sips resize to ${SIZE}x${SIZE} failed for $OUT" >&2; exit 1;
  }
fi

# Strip the backplate to alpha if Gemini emitted RGB (it usually does despite
# the prompt). Uses rembg locally — never flux2 inpaint (user rule).
#
# v0.3.24: caller can set NO_REMBG=1 to skip the alpha-strip. Tiles fill
# the whole canvas — rembg sometimes mis-classifies the entire texture as
# background (esp. uniform dark cracked-stone / void) and zeros 100% of
# the alpha, producing a 563-byte empty PNG. gen-styled-tile.sh sets
# NO_REMBG=1 since tiles never need transparency.
COLOR="$(sips -g samplesPerPixel "$OUT" 2>/dev/null | awk '/samplesPerPixel/ {print $2}')"
if [ "$COLOR" != "4" ] && [ "${NO_REMBG:-0}" != "1" ]; then
  if command -v rembg >/dev/null 2>&1; then
    # rembg can't read+write the same path (truncates input on open). Stage
    # through a sibling temp file.
    TMPOUT="${OUT%.png}.rgba.tmp.png"
    rembg i "$OUT" "$TMPOUT" >/dev/null 2>&1 || {
      echo "FAIL: rembg failed for $OUT" >&2; rm -f "$TMPOUT"; exit 1;
    }
    mv "$TMPOUT" "$OUT"
  else
    echo "WARN: $OUT is RGB and rembg not installed; install via 'pip install rembg'" >&2
  fi
fi

# Verify final file
ACTUAL="$(sips -g pixelWidth -g pixelHeight "$OUT" 2>/dev/null | awk '/pixel/ {print $2}' | xargs)"
FORMAT="$(file -b "$OUT" | grep -oE 'RGBA?')"
echo "OK: $OUT ${ACTUAL// /x} $FORMAT"
