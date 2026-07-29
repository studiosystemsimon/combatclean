#!/usr/bin/env python3
# gen-seedance-anim.py — generate a spritesheet animation from an anchor image via the Fortis MME
# (Seedance spritesheets), the same endpoint FrogGame uses. Fallback chain:
#   FortisGames/Seedance2MultipleSpritesheets -> FortisGames/SeedanceSpritesheets -> FortisGames/VeoSpritesheets
#
# Usage: gen-seedance-anim.py <anchor.png> "<prompt>" <out-raw-sheet.png>
import json, os, sys, base64, subprocess, urllib.request, time

BASE_URL = "https://gcp-mme-1021009472953.us-central1.run.app"
MODELS = ["FortisGames/Seedance2MultipleSpritesheets",
          "FortisGames/SeedanceSpritesheets",
          "FortisGames/VeoSpritesheets"]

anchor, prompt, out_raw = sys.argv[1], sys.argv[2], sys.argv[3]

def token():
    return subprocess.check_output(["fortis-ai-gateway", "token"]).decode().strip()

b64 = base64.b64encode(open(anchor, "rb").read()).decode("ascii")
session_id = "combatclean-vortex-%d" % int(time.time())

def try_model(model, drop_aspect=False):
    params = {"base_model": model}
    if not drop_aspect:
        params["aspect_ratio"] = "1:1"
    payload = {"session_id": session_id, "inputs": prompt, "parameters": params,
               "image": [b64, b64]}
    pf = "/tmp/seedance_payload.json"
    open(pf, "w").write(json.dumps(payload))
    uf = "/tmp/seedance_urls.json"
    print(f"[seedance] POST {model} (may take 2-5 min)...", flush=True)
    rc = subprocess.run(["curl", "-s", "-X", "POST", f"{BASE_URL}/predictions-urls",
        "-H", "Content-Type: application/json", "-H", "Accept: application/json",
        "-H", f"Authorization: Bearer {token()}",
        "-d", f"@{pf}", "-o", uf, "--max-time", "600"]).returncode
    if rc != 0:
        print(f"[seedance] curl rc={rc}", flush=True); return None
    try:
        raw = open(uf).read().strip(); data = json.loads(raw)
    except Exception as e:
        print(f"[seedance] non-JSON: {e}", flush=True); return None
    urls = data if isinstance(data, list) else data.get("images", data.get("outputs", []))
    if not urls:
        print(f"[seedance] no urls: {raw[:300]}", flush=True); return None
    return urls[0]

url = None
for i, m in enumerate(MODELS):
    url = try_model(m, drop_aspect=(m.endswith("VeoSpritesheets")))
    if url: print(f"[seedance] OK via {m}", flush=True); break

if not url:
    print("FAIL: all models returned no image", file=sys.stderr); sys.exit(1)

req = urllib.request.Request(url, headers={
    "Accept": "image/png, image/jpeg, application/octet-stream",
    "Authorization": f"Bearer {token()}"})
with urllib.request.urlopen(req, timeout=120) as resp, open(out_raw, "wb") as f:
    f.write(resp.read())
from PIL import Image
print(f"OK raw sheet: {out_raw} {Image.open(out_raw).size}")
