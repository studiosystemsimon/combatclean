#!/usr/bin/env bash
# === gen-image-fortis-ref.sh ===
#
# Variant of gen-image-fortis.sh that ALSO sends one reference image
# alongside the text prompt. Gemini 2.5 Flash Image then anchors the
# generation to the reference's character design / palette / outline.
# Used by the hop_sheet pipeline so animation strips don't reinvent
# the frog — they re-use the EXACT character from idle.png.
#
# === Usage ===
#
#   scripts/art/gen-image-fortis-ref.sh <out-path> "<prompt>" <ref-image> [target-size]
#
# `ref-image` is the PNG to anchor to (e.g. assets/heroes/monk/idle.png).
# All other behaviour identical to gen-image-fortis.sh.

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <out-path> \"<prompt>\" <ref-image> [target-size]" >&2
  exit 2
fi

OUT="$1"
PROMPT="$2"
REF="$3"
SIZE="${4:-256}"

# v0.5.80 — REF may be a single path OR a comma-separated list. Validate each.
IFS=',' read -r -a _refs <<< "$REF"
for _r in "${_refs[@]}"; do
  _r_trimmed="${_r#"${_r%%[![:space:]]*}"}"
  _r_trimmed="${_r_trimmed%"${_r_trimmed##*[![:space:]]}"}"
  if [ ! -f "$_r_trimmed" ]; then
    echo "FAIL: reference image not found: $_r_trimmed" >&2
    exit 2
  fi
done

PROXY="https://vertex-ai-proxy-284250591143.us-east5.run.app/v1"
ENDPOINT="${PROXY}/projects/agentic-coding-sandbox/locations/global/publishers/google/models/gemini-2.5-flash-image:generateContent"

mkdir -p "$(dirname "$OUT")"
TMPJSON="$(mktemp -t fortis-gen.XXXX.json)"
trap 'rm -f "$TMPJSON"' EXIT

TOKEN="$(fortis-ai-gateway token)"

# v0.5.80 — REF may be a single path OR a comma-separated list of paths.
# Multi-ref support: when REF contains commas, every listed file is attached
# as a separate inlineData part. Gemini 2.5 Flash Image uses ALL refs as
# soft style anchors (proven viable for muffinpines-style locking).
# v0.5.81 — body can be > argv limit (4 refs x ~1MB b64 each), so write to a
# temp file and let curl stream it from disk with -d @file.
TMPBODY="$(mktemp -t fortis-body.XXXX.json)"
trap 'rm -f "$TMPJSON" "$TMPBODY"' EXIT
python3 - "$PROMPT" "$REF" "$TMPBODY" <<'PYEOF'
import sys, json, base64, pathlib, mimetypes
prompt = sys.argv[1]
ref_arg = sys.argv[2]
out_path = sys.argv[3]
parts = [{"text": prompt}]
for raw in ref_arg.split(','):
    p = pathlib.Path(raw.strip())
    if not p.exists():
        sys.stderr.write(f'FAIL: ref not found: {p}\n'); sys.exit(2)
    mime = mimetypes.guess_type(str(p))[0] or 'image/png'
    b64 = base64.b64encode(p.read_bytes()).decode('ascii')
    parts.append({"inlineData": {"mimeType": mime, "data": b64}})
body = {
    "contents": [{"role": "user", "parts": parts}],
    "generationConfig": {"responseModalities": ["IMAGE"]}
}
pathlib.Path(out_path).write_text(json.dumps(body))
PYEOF

# v0.7.X (P2) — retry-on-transient (same shape as gen-image-fortis.sh).
HTTP=""
for attempt in 1 2 3; do
  HTTP="$(curl -sS -w '%{http_code}' -X POST "$ENDPOINT" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept-Encoding: identity" \
    --data-binary "@${TMPBODY}" \
    -o "$TMPJSON" || echo "")"
  if [ "$HTTP" = "200" ]; then break; fi
  case "$HTTP" in
    5[0-9][0-9]|"")
      delay=$([ $attempt -eq 1 ] && echo 5 || ([ $attempt -eq 2 ] && echo 15 || echo 45))
      echo "  [retry $attempt/3] HTTP=$HTTP — sleeping ${delay}s" >&2
      sleep $delay
      TOKEN="$(fortis-ai-gateway token)"
      continue ;;
    *)
      break ;;
  esac
done

if [ "$HTTP" != "200" ]; then
  echo "FAIL: HTTP $HTTP from gateway after retries. Raw response below:" >&2
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

# v0.5.91 — resize chain fix. Gemini returns ~1024 native. Old behaviour:
# pre-downscale to $SIZE here, then downstream tight_pack would crop the frog
# bbox and UPSCALE it back to fill 85% of $SIZE — that shrink-then-upscale
# of already-quantised content is the source of the "artifact-y" look.
# New behaviour: caller may set SKIP_SHRINK=1 to KEEP the raw ~1024 output,
# letting downstream tight_pack do the crop + ONE high-quality LANCZOS
# downscale (no upscale step). Default still shrinks for back-compat with
# scripts that don't know about the new flow.
if [ "${SKIP_SHRINK:-0}" = "1" ]; then
  echo "OK-REF: $OUT (raw ~1024, deferred downscale)"
else
  sips -Z "$SIZE" "$OUT" >/dev/null 2>&1 || true
  echo "OK-REF: $OUT ${SIZE}x${SIZE}"
fi
