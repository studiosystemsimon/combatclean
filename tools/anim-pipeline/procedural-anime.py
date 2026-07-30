#!/usr/bin/env python3
# Coherent flat-anime loop from ONE clean still: iridescent spectral hue-cycle shimmer + gentle
# flame sway + soft pulse. Perfectly looping (hue cycles 360deg, sway/pulse are sine over the loop).
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
outdir = os.path.join(here, "out"); framedir = os.path.join(here, "frames")
os.makedirs(outdir, exist_ok=True); os.makedirs(framedir, exist_ok=True)
N = 12; CELL = 256; WORK = 512
SWAY = 9.0            # px of flame sway at WORK res
PULSE = 0.03         # +/- scale pulse

# --- key the anime still (flood white bg from corners, keep the enclosed core) ---
im = Image.open(os.path.join(here, "soul-anime.png")).convert("RGB")
w, h = im.size
for c in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]:
    ImageDraw.floodfill(im, c, (255,0,255), thresh=32)
a = np.asarray(im)
bg = (a[...,0]==255)&(a[...,1]==0)&(a[...,2]==255)
keep = ~bg
k = keep.copy()
k[1:,:]&=keep[:-1,:]; k[:-1,:]&=keep[1:,:]; k[:,1:]&=keep[:,:-1]; k[:,:-1]&=keep[:,1:]
base = Image.fromarray(np.dstack([a.astype(np.uint8), np.where(k,255,0).astype(np.uint8)]), "RGBA")
bbox = base.getbbox()
if bbox: base = base.crop(bbox)
# square-pad + work size
s = max(base.size); sq = Image.new("RGBA",(s,s),(0,0,0,0)); sq.alpha_composite(base,((s-base.width)//2,(s-base.height)//2))
base = sq.resize((WORK, WORK), Image.LANCZOS)

rgb = np.asarray(base.convert("RGB"))
alpha = np.asarray(base.split()[-1])
H, W = alpha.shape
# rows above ~48% height = flame region (sway there, taper to 0 at the orb)
flame_top = int(H*0.02); orb_line = int(H*0.52)
ramp = np.zeros(H, np.float32)
for y in range(H):
    if y < orb_line:
        ramp[y] = np.clip((orb_line - y)/(orb_line - flame_top), 0, 1)**1.3

def hue_shift(img_rgb, frac):
    hsv = Image.fromarray(img_rgb, "RGB").convert("HSV")
    hh, ss, vv = hsv.split()
    off = int(round(frac*255)) % 256
    hh = hh.point(lambda v: (v+off) % 256)
    return np.asarray(Image.merge("HSV",(hh,ss,vv)).convert("RGB"))

def frame(i):
    ph = 2*np.pi*i/N
    shifted = hue_shift(rgb, i/N)                       # iridescent spectral shimmer, loops at N
    outrgb = np.empty_like(shifted); outa = np.empty_like(alpha)
    for y in range(H):                                  # per-row horizontal sway (flame waves), loops
        dx = int(round(SWAY * ramp[y] * np.sin(ph + y*0.015)))
        outrgb[y] = np.roll(shifted[y], dx, axis=0)
        outa[y]  = np.roll(alpha[y], dx, axis=0)
    img = Image.fromarray(np.dstack([outrgb, outa]), "RGBA")
    sc = 1.0 + PULSE*np.sin(ph)                         # gentle breathing pulse, loops
    nw = int(W*sc); r = img.resize((nw,nw), Image.LANCZOS)
    canvas = Image.new("RGBA",(W,H),(0,0,0,0)); canvas.alpha_composite(r,((W-nw)//2,(H-nw)//2))
    return canvas.resize((CELL,CELL), Image.LANCZOS)

frames = [frame(i) for i in range(N)]
for i,f in enumerate(frames,1): f.save(os.path.join(framedir,"soulanime-%02d.png"%i))

def on_dark(f):
    bgc = Image.new("RGBA", f.size, (10,10,14,255))
    glow = f.filter(ImageFilter.GaussianBlur(10)); bgc.alpha_composite(glow); bgc.alpha_composite(f)
    return bgc.convert("RGB")

strip = Image.new("RGBA",(CELL*N,CELL),(0,0,0,0))
for i,f in enumerate(frames): strip.alpha_composite(f,(i*CELL,0))
strip.save(os.path.join(outdir,"soulanime-strip.png"))
gif=[on_dark(f) for f in frames]
gif[0].save(os.path.join(outdir,"soulanime.gif"),save_all=True,append_images=gif[1:],duration=80,loop=0,disposal=2)
frames[0].save(os.path.join(outdir,"soulanime.apng"),save_all=True,append_images=frames[1:],duration=80,loop=0)
review=Image.new("RGB",(CELL*N,CELL),(12,12,16))
for i,f in enumerate(frames): review.paste(on_dark(f),(i*CELL,0))
review.save("/tmp/anime_proc_review.png")
print("OK — %d coherent procedural anime frames"%N)
