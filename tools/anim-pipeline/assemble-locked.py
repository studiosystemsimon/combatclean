#!/usr/bin/env python3
# Rich frame-based flame loop with a LOCKED orb. Per frame: key white bg, find the bright core,
# align (scale+translate) so the core sits at a fixed centre/size, then overlay a static orb (same
# alignment) so the orb is pixel-identical every frame while the AI flame above animates. Colours fixed.
import os, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
outdir = os.path.join(here, "out"); framedir = os.path.join(here, "frames")
os.makedirs(outdir, exist_ok=True); os.makedirs(framedir, exist_ok=True)
WORK = 512; CELL = 256
CX, CY, R_T = 256, 322, 118        # target core centre + radius on the WORK canvas

def key_white(path):
    im = Image.open(path).convert("RGB"); w, h = im.size
    for c in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)]:
        ImageDraw.floodfill(im, c, (255,0,255), thresh=32)
    a = np.asarray(im)
    bgm = (a[...,0]==255)&(a[...,1]==0)&(a[...,2]==255); keep = ~bgm
    k = keep.copy(); k[1:,:]&=keep[:-1,:]; k[:-1,:]&=keep[1:,:]; k[:,1:]&=keep[:,:-1]; k[:,:-1]&=keep[:,1:]
    return Image.fromarray(np.dstack([a.astype(np.uint8), np.where(k,255,0).astype(np.uint8)]),"RGBA")

def core_stats(rgba):
    a = np.asarray(rgba); r,g,b,al = a[...,0],a[...,1],a[...,2],a[...,3]
    core = (al>0)&(r>205)&(g>205)&(b>205)
    if core.sum() < 30:                        # fallback: use alpha bbox centre
        ys,xs = np.where(al>0)
        if len(xs)==0: return WORK/2, WORK/2, R_T
        return xs.mean(), ys.mean(), R_T
    ys,xs = np.where(core)
    return xs.mean(), ys.mean(), max(18.0, (core.sum()/np.pi)**0.5)

def align(rgba):
    cx, cy, r = core_stats(rgba)
    sc = R_T / r
    nw, nh = max(1,int(rgba.width*sc)), max(1,int(rgba.height*sc))
    rs = rgba.resize((nw,nh), Image.LANCZOS)
    ox, oy = int(round(CX - cx*sc)), int(round(CY - cy*sc))
    canv = Image.new("RGBA",(WORK,WORK),(0,0,0,0)); canv.alpha_composite(rs,(ox,oy))
    return canv

# static orb layer from the anime still, aligned + feathered (keep orb, drop the still's flame)
orb_layer = align(key_white(os.path.join(here,"soul-anime.png")))
oa = np.asarray(orb_layer).copy()
yy = np.arange(WORK)[:,None]
top = CY - R_T*0.85; fade = R_T*0.5
ramp = np.clip((yy - (top - fade))/fade, 0, 1)      # 0 above the orb → 1 at/under orb top
oa[...,3] = (oa[...,3]*ramp).astype(np.uint8)
orb_layer = Image.fromarray(oa,"RGBA")

frames=[]
for p in sorted(glob.glob(os.path.join(here,"aframes","af-*.png"))):
    a = align(key_white(p))          # aligned AI frame (orb+flame)
    comp = a.copy(); comp.alpha_composite(orb_layer)   # lock the orb on top
    bbox = comp.getbbox(); comp = comp.crop(bbox) if bbox else comp
    s = max(comp.size); sq = Image.new("RGBA",(s,s),(0,0,0,0)); sq.alpha_composite(comp,((s-comp.width)//2,(s-comp.height)//2))
    frames.append(sq.resize((CELL,CELL), Image.LANCZOS))

for i,f in enumerate(frames,1): f.save(os.path.join(framedir,"soulanime-%02d.png"%i))
def on_dark(f):
    bgc=Image.new("RGBA",f.size,(10,10,14,255)); glow=f.filter(ImageFilter.GaussianBlur(9))
    bgc.alpha_composite(glow); bgc.alpha_composite(f); return bgc.convert("RGB")
strip=Image.new("RGBA",(CELL*len(frames),CELL),(0,0,0,0))
for i,f in enumerate(frames): strip.alpha_composite(f,(i*CELL,0))
strip.save(os.path.join(outdir,"soulanime-strip.png"))
g=[on_dark(f) for f in frames]
g[0].save(os.path.join(outdir,"soulanime.gif"),save_all=True,append_images=g[1:],duration=90,loop=0,disposal=2)
frames[0].save(os.path.join(outdir,"soulanime.apng"),save_all=True,append_images=frames[1:],duration=90,loop=0)
rev=Image.new("RGB",(CELL*len(frames),CELL),(12,12,16))
for i,f in enumerate(frames): rev.paste(on_dark(f),(i*CELL,0))
rev.save("/tmp/locked_review.png")
print("OK — %d rich frames, orb locked"%len(frames))
