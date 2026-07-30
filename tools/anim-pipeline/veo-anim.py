#!/usr/bin/env python3
# Veo 2 image->video via the Fortis Vertex proxy. Real mp4, faithful to the input image.
# Usage: veo-anim.py <image.png> "<prompt>" <out.mp4> [durationSeconds] [aspectRatio]
import json, base64, subprocess, time, sys, urllib.request

PROXY = "https://vertex-ai-proxy-284250591143.us-east5.run.app/v1"
MODEL = "projects/agentic-coding-sandbox/locations/global/publishers/google/models/veo-2.0-generate-001"
img, prompt, out = sys.argv[1], sys.argv[2], sys.argv[3]
dur = int(sys.argv[4]) if len(sys.argv) > 4 else 6
ar  = sys.argv[5] if len(sys.argv) > 5 else "16:9"

def tok(): return subprocess.check_output(["fortis-ai-gateway", "token"]).decode().strip()
def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {tok()}", "Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=180).read().decode())

b64 = base64.b64encode(open(img, "rb").read()).decode()
body = {"instances": [{"prompt": prompt, "image": {"bytesBase64Encoded": b64, "mimeType": "image/png"}}],
        "parameters": {"sampleCount": 1, "durationSeconds": dur, "aspectRatio": ar}}
op = post(f"{PROXY}/{MODEL}:predictLongRunning", body)
name = op["name"]; print("op:", name, flush=True)

st = {}
for i in range(90):
    time.sleep(10)
    st = post(f"{PROXY}/{MODEL}:fetchPredictOperation", {"operationName": name})
    if st.get("done"): print(" done", flush=True); break
    print(".", end="", flush=True)

resp = st.get("response", {}) or {}
vids = resp.get("videos") or resp.get("generatedVideos") or resp.get("generatedSamples") or []
if not vids:
    print("NO VIDEO — full op keys:", list(st.keys()), "| resp:", json.dumps(resp)[:600]); sys.exit(1)
v = vids[0]
# unwrap nested {video:{...}}
if "video" in v and isinstance(v["video"], dict): v = v["video"]
if v.get("bytesBase64Encoded"):
    open(out, "wb").write(base64.b64decode(v["bytesBase64Encoded"])); print("saved", out)
else:
    uri = v.get("gcsUri") or v.get("uri")
    print("video URI (needs fetch):", uri); print("raw:", json.dumps(v)[:400])
