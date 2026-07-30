#!/usr/bin/env python3
# 128x128 looping IDLE animation of the gear helmet — keeps the EXACT art, adds life procedurally:
# gentle float (bob), a shine sweep across the metal, and twinkling sparkles. Perfectly looping.
# Usage: procedural-helm.py [FRAMES]
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(here), "gear-pipeline", "reference", "ref-gear-helm.png")
outdir = os.path.join(here, "out"); framedir = os.path.join(here, "helm-frames")
os.makedirs(outdir, exist_ok=True); os.makedirs(framedir, exist_ok=True)
FRAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 12
CELL = 128; WORK = 256
BOB = 5.0          # px float amplitude (at WORK res)
WOB = 1.4          # deg wobble

# --- key white bg -> transparent, crop, fit into WORK canvas with margin ---
im = Image.open(SRC).convert("RGB"); w, h = im.size
for c in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]:
    ImageDraw.floodfill(im, c, (255,0,255), thresh=30)
a = np.asarray(im); bg = (a[...,0]==255)&(a[...,1]==0)&(a[...,2]==255); keep = ~bg
k = keep.copy(); k[1:,:]&=keep[:-1,:]; k[:-1,:]&=keep[1:,:]; k[:,1:]&=keep[:,:-1]; k[:,:-1]&=keep[:,1:]
helm = Image.fromarray(np.dstack([a.astype(np.uint8), np.where(k,255,0).astype(np.uint8)]),"RGBA")
bb = helm.getbbox();  helm = helm.crop(bb) if bb else helm
fit = int(WORK*0.84); sc = fit/max(helm.size)
helm = helm.resize((max(1,int(helm.width*sc)), max(1,int(helm.height*sc))), Image.LANCZOS)
base = Image.new("RGBA",(WORK,WORK),(0,0,0,0))
base.alpha_composite(helm, ((WORK-helm.width)//2, (WORK-helm.height)//2))
base_rgb = np.asarray(base.convert("RGB")).astype(np.float32)/255.0
base_a = np.asarray(base.split()[-1]).astype(np.float32)/255.0

# --- 4-point sparkle sprite ---
def star(size):
    g = np.linspace(-1,1,size); X,Y = np.meshgrid(g,g)
    thin, long = 0.10, 0.62
    s = (np.exp(-(X/thin)**2)*np.exp(-(Y/long)**2) + np.exp(-(Y/thin)**2)*np.exp(-(X/long)**2))
    s += 0.7*np.exp(-((X**2+Y**2)/0.02))
    return np.clip(s,0,1)
STAR = star(48)
SPARKS = [(0.30,0.17,0.0),(0.71,0.14,1.9),(0.15,0.46,3.6),(0.86,0.50,5.0),(0.5,0.70,2.7)]  # x,y,phase

ys, xs = np.mgrid[0:WORK,0:WORK].astype(np.float32)
diag = xs - ys; dmax = float(np.abs(diag).max())

def frame(i):
    t = i/FRAMES; ph = 2*math.pi*t
    # shine sweep (screen-add a moving diagonal highlight over the metal)
    p = -dmax + t*2*dmax
    stripe = np.exp(-((diag - p)/(WORK*0.16))**2) * 0.55
    rgb = 1.0 - (1.0-base_rgb)*(1.0-stripe[...,None]*base_a[...,None])   # screen, masked to helmet
    img = np.dstack([(np.clip(rgb,0,1)*255).astype(np.uint8), (base_a*255).astype(np.uint8)])
    layer = Image.fromarray(img,"RGBA")
    # bob + wobble
    layer = layer.rotate(WOB*math.sin(ph), resample=Image.BICUBIC, center=(WORK/2, WORK*0.62))
    canvas = Image.new("RGBA",(WORK,WORK),(0,0,0,0))
    canvas.alpha_composite(layer, (0, int(round(BOB*math.sin(ph)))))
    # sparkles (twinkle in sequence)
    cd = ImageDraw.Draw(canvas)
    for (sx,sy,sp) in SPARKS:
        amp = max(0.0, math.sin(ph + sp))**2
        if amp < 0.02: continue
        sz = int(28*(0.4+0.6*amp))
        st = (STAR*amp*255).astype(np.uint8)
        stimg = Image.fromarray(np.dstack([np.full_like(st,255),np.full_like(st,255),np.full_like(st,255),st]),"RGBA").resize((sz,sz),Image.LANCZOS)
        canvas.alpha_composite(stimg, (int(sx*WORK-sz/2), int(sy*WORK-sz/2)))
    return canvas.resize((CELL,CELL), Image.LANCZOS)

frames=[frame(i) for i in range(FRAMES)]
for i,f in enumerate(frames,1): f.save(os.path.join(framedir,"helm-%02d.png"%i))
# strip + gif + apng
strip=Image.new("RGBA",(CELL*FRAMES,CELL),(0,0,0,0))
for i,f in enumerate(frames): strip.alpha_composite(f,(i*CELL,0))
strip.save(os.path.join(outdir,"helm-strip.png"))
def on(f,bg):
    c=Image.new("RGBA",f.size,bg); c.alpha_composite(f); return c.convert("RGB")
g=[on(f,(235,235,235,255)) for f in frames]
g[0].save(os.path.join(outdir,"helm.gif"),save_all=True,append_images=g[1:],duration=90,loop=0,disposal=2)
frames[0].save(os.path.join(outdir,"helm.apng"),save_all=True,append_images=frames[1:],duration=90,loop=0)
rev=Image.new("RGB",(CELL*FRAMES,CELL),(230,230,230))
for i,f in enumerate(frames): rev.paste(on(f,(230,230,230,255)),(i*CELL,0))
rev.save("/tmp/helm_review.png")
print("OK — %d-frame 128x128 helmet loop"%FRAMES)
