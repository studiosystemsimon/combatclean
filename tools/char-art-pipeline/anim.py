#!/usr/bin/env python3
"""rpg-characters Seedance animation driver.
Calls the Seedance spritesheet endpoint directly with a STYLE-PRESERVING prompt
(keeps gradients / black outline / chunky gradient hair / SSS skin — NOT the
frog-locked flat-vector navy style). For each class: idle + attack.
Outputs per class under anim/<class>/: <type>_raw.png (strip), <type>.gif,
<type>_frames.png (static review). Also builds anim/review_<type>.png montages.

Usage:
  python3 anim.py random 5          # pick 5 random classes
  python3 anim.py knight mage rogue # explicit classes
"""
import sys, os, json, base64, subprocess, uuid, random, io, urllib.request, pathlib, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
FINAL = ROOT / "final"
ANIM = ROOT / "anim"; ANIM.mkdir(exist_ok=True)
BASE_URL = "https://gcp-mme-1021009472953.us-central1.run.app"
MODEL = "FortisGames/Seedance2MultipleSpritesheets"
FALLBACK = "FortisGames/SeedanceSpritesheets"

STYLE_KEEP = ("in the EXACT art style of the reference image: the SAME character, same face and "
  "uniform eyes, same chunky faceted hair with its smooth root-to-tip colour GRADIENT (KEEP the "
  "gradients, do NOT flatten), same ornate layered Honkai-style costume, same THICK BLACK outer "
  "outline with darker-local-colour inner lines, same PALE subsurface-scattering skin, same rich "
  "saturated colours. Same character identity, proportions and size in every frame. NOT pixel art, "
  "NOT flat-vector, NOT navy-outline, do NOT change the art style away from the reference. ")

def prompt_for(kind, n):
    if kind == "idle":
        return (f"Render a smooth video sequence of {n} frames of a LIVELY IDLE bob {STYLE_KEEP}"
          "The reference pose is for identity only — the character stands in a calm ready combat "
          "stance and gently bobs: chest, shoulders, head and the held weapon rise and fall together "
          "and the hair sways, feet planted, clearly moving not frozen. "
          "Each frame centered, isolated on a plain solid white background. No text, no watermark, "
          "no magic effects, no glow, no particles.")
    return (f"Render a smooth video sequence of {n} frames of a dynamic ATTACK {STYLE_KEEP}"
      "The reference pose is for identity only. Frame 1 is the EXPLOSIVE ATTACK PEAK — the character "
      "swings/thrusts/draws their own weapon (from the reference) at full power; the following frames "
      "settle back to a ready combat stance. Feet stay near the lower edge. "
      "Each frame centered, isolated on a plain solid white background. No text, no watermark, "
      "no magic effects, no glow, no particles.")

def token():
    return subprocess.run(["fortis-ai-gateway","token"],capture_output=True,text=True).stdout.strip()

def white_b64(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255,255,255,255)); bg.paste(im,(0,0),im)
    buf = io.BytesIO(); bg.convert("RGB").save(buf,format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def post(prompt, img_b64, model):
    payload = {"session_id": uuid.uuid4().hex[:16],
               "inputs": prompt,
               "parameters": {"base_model": model, "aspect_ratio": "1:1"},
               "image": [img_b64, img_b64]}
    pf = f"/tmp/anim_payload_{uuid.uuid4().hex[:8]}.json"
    with open(pf,"w") as f: json.dump(payload,f)
    of = pf+".out"
    subprocess.run(["curl","-s","-X","POST",f"{BASE_URL}/predictions-urls",
        "-H","Content-Type: application/json","-H","Accept: application/json",
        "-H",f"Authorization: Bearer {token()}","-d",f"@{pf}","-o",of,"--max-time","600"])
    try:
        data = json.load(open(of))
    except Exception:
        data = None
    os.remove(pf);
    if os.path.exists(of): os.remove(of)
    if not data: return None
    urls = data if isinstance(data,list) else data.get("images",data.get("outputs",[]))
    return urls[0] if urls else None

def download(url, dst):
    req = urllib.request.Request(url, headers={"Accept":"image/png,image/jpeg,application/octet-stream",
        "Authorization":f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dst,"wb") as o: o.write(r.read())

def slice_strip(raw_path, n):
    im = Image.open(raw_path).convert("RGBA")
    W,H = im.size
    fw = W // n
    return [im.crop((i*fw,0,(i+1)*fw,H)) for i in range(n)]

def make_gif(frames, dst, ms):
    fs = [f.convert("RGBA") for f in frames]
    fs[0].save(dst, save_all=True, append_images=fs[1:], duration=ms, loop=0, disposal=2)

def frame_strip_png(frames, dst, label):
    n=len(frames); cell=220; pad=8; lh=26
    W=n*cell+(n+1)*pad; Hh=cell+2*pad+lh
    sh=Image.new("RGB",(W,Hh),(240,240,244)); d=ImageDraw.Draw(sh)
    try: f=ImageFont.truetype("/System/Library/Fonts/SFNSRounded.ttf",20)
    except: f=None
    for i,fr in enumerate(frames):
        c=Image.new("RGB",(cell,cell),(255,255,255)); t=fr.convert("RGB").copy(); t.thumbnail((cell-6,cell-6),Image.LANCZOS)
        c.paste(t,((cell-t.size[0])//2,(cell-t.size[1])//2)); sh.paste(c,(pad+i*(cell+pad),pad))
    d.text((pad,cell+pad+2),label,fill=(20,20,24),font=f)
    sh.save(dst)

def gen(cls, kind):
    n = 4 if kind=="idle" else 6
    ms = 160 if kind=="idle" else 90
    d = ANIM/cls; d.mkdir(parents=True,exist_ok=True)
    ib = white_b64(FINAL/f"{cls}.png")
    p = prompt_for(kind,n)
    url=None
    for model in (MODEL, FALLBACK):
        for attempt in range(2):
            url = post(p, ib, model)
            if url: break
        if url: break
    if not url:
        return (cls,kind,"FAIL-no-url")
    raw = d/f"{kind}_raw.png"
    try: download(url, raw)
    except Exception as e: return (cls,kind,f"FAIL-dl:{e}")
    try:
        frames = slice_strip(raw, n)
        make_gif(frames, d/f"{kind}.gif", ms)
        frame_strip_png(frames, d/f"{kind}_frames.png", f"{cls.upper()} — {kind}")
    except Exception as e:
        return (cls,kind,f"FAIL-slice:{e}")
    return (cls,kind,f"OK ({Image.open(raw).size[0]}x{Image.open(raw).size[1]} -> {n}f)")

# ---- select classes ----
all_slugs=[l.split("\t",1)[0].strip() for l in (ROOT/"classes.tsv").read_text().splitlines() if l.strip()]
args=sys.argv[1:]
if args and args[0]=="random":
    k=int(args[1]) if len(args)>1 else 5
    random.seed(); chosen=random.sample(all_slugs,k)
elif args:
    chosen=[a for a in args if a in all_slugs]
else:
    chosen=random.sample(all_slugs,5)
print("SELECTED:", ", ".join(chosen), flush=True)

tasks=[(c,k) for c in chosen for k in ("idle","attack")]
results=[]
with ThreadPoolExecutor(max_workers=len(tasks)) as ex:
    futs={ex.submit(gen,c,k):(c,k) for c,k in tasks}
    for fu in as_completed(futs):
        r=fu.result(); results.append(r); print("  ",r[0],r[1],"->",r[2],flush=True)

# ---- montages of static frame strips ----
for kind in ("idle","attack"):
    strips=[ANIM/c/f"{kind}_frames.png" for c in chosen if (ANIM/c/f"{kind}_frames.png").exists()]
    if not strips: continue
    ims=[Image.open(s).convert("RGB") for s in strips]
    W=max(i.width for i in ims); H=sum(i.height for i in ims)+8*(len(ims)+1)
    mont=Image.new("RGB",(W,H),(210,210,216)); y=8
    for im in ims: mont.paste(im,(0,y)); y+=im.height+8
    mont.save(ROOT/f"review_{kind}.png"); print(f"review_{kind}.png", mont.size, flush=True)
print("DONE", flush=True)
