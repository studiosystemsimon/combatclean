#!/usr/bin/env python3
# Animate the ACTUAL shape (no colour change): flow the flame region with a looping turbulence warp
# so the wisps lick / ripple / rise, while the orb stays fixed. Colours are sampled from the still
# (never shifted). Loops because the turbulence phases advance 2*pi over the N frames.
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
outdir = os.path.join(here, "out"); framedir = os.path.join(here, "frames")
os.makedirs(outdir, exist_ok=True); os.makedirs(framedir, exist_ok=True)
N = 12; CELL = 256; WORK = 640
AMPX, AMPY = 9.0, 13.0

# --- key the anime still (flood white bg, keep enclosed core) ---
im = Image.open(os.path.join(here, "soul-anime.png")).convert("RGB")
w, h = im.size
for c in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]:
    ImageDraw.floodfill(im, c, (255,0,255), thresh=32)
a = np.asarray(im)
bg = (a[...,0]==255)&(a[...,1]==0)&(a[...,2]==255); keep = ~bg
k = keep.copy(); k[1:,:]&=keep[:-1,:]; k[:-1,:]&=keep[1:,:]; k[:,1:]&=keep[:,:-1]; k[:,:-1]&=keep[:,1:]
base = Image.fromarray(np.dstack([a.astype(np.uint8), np.where(k,255,0).astype(np.uint8)]),"RGBA")
bb = base.getbbox();  base = base.crop(bb) if bb else base
s = max(base.size); sq = Image.new("RGBA",(s,s),(0,0,0,0)); sq.alpha_composite(base,((s-base.width)//2,(s-base.height)//2))
base = sq.resize((WORK,WORK), Image.LANCZOS)
rgb = np.asarray(base.convert("RGB")); alpha = np.asarray(base.split()[-1])
H, W = alpha.shape

# flame region ramp: 0 on/below the orb, →1 at the flame tips (so ONLY the flame flows)
orb_line = int(H*0.55); top = int(H*0.03)
ramp = np.zeros(H, np.float32)
for y in range(H):
    if y < orb_line:
        t = (orb_line - y)/(orb_line - top); ramp[y] = np.clip(t,0,1)**1.4
ys, xs = np.mgrid[0:H,0:W].astype(np.float32)
rampY = ramp[ys.astype(int)]
TAU = 2*np.pi

def frame(i):
    t = i/N
    fx = (np.sin(xs*0.030 + ys*0.020 + TAU*t) + 0.5*np.sin(xs*0.070 - ys*0.050 + 2*TAU*t + 1.7))/1.5
    fy = (np.cos(xs*0.025 - ys*0.030 + TAU*t + 0.9) + 0.5*np.sin(xs*0.050 + ys*0.040 - 2*TAU*t))/1.5
    dx = (AMPX*rampY*fx).astype(np.int32)
    dy = (AMPY*rampY*fy).astype(np.int32)
    sy = np.clip(ys.astype(np.int32)+dy, 0, H-1); sx = np.clip(xs.astype(np.int32)+dx, 0, W-1)
    out = np.dstack([rgb[sy,sx], alpha[sy,sx]])
    return Image.fromarray(out,"RGBA").resize((CELL,CELL), Image.LANCZOS)

frames=[frame(i) for i in range(N)]
for i,f in enumerate(frames,1): f.save(os.path.join(framedir,"soulanime-%02d.png"%i))

def on_dark(f):
    bgc=Image.new("RGBA",f.size,(10,10,14,255)); glow=f.filter(ImageFilter.GaussianBlur(9))
    bgc.alpha_composite(glow); bgc.alpha_composite(f); return bgc.convert("RGB")
strip=Image.new("RGBA",(CELL*N,CELL),(0,0,0,0))
for i,f in enumerate(frames): strip.alpha_composite(f,(i*CELL,0))
strip.save(os.path.join(outdir,"soulanime-strip.png"))
g=[on_dark(f) for f in frames]
g[0].save(os.path.join(outdir,"soulanime.gif"),save_all=True,append_images=g[1:],duration=80,loop=0,disposal=2)
frames[0].save(os.path.join(outdir,"soulanime.apng"),save_all=True,append_images=frames[1:],duration=80,loop=0)
rev=Image.new("RGB",(CELL*N,CELL),(12,12,16))
for i,f in enumerate(frames): rev.paste(on_dark(f),(i*CELL,0))
rev.save("/tmp/flame_flow_review.png")
print("OK — %d shape-animated frames (colours fixed)"%N)
