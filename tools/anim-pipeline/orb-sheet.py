#!/usr/bin/env python3
# Build a spritesheet + looping gif from the vortex-orb Veo video.
# Usage: orb-sheet.py [FRAMES] [CELL]
import os, sys, glob, math
import numpy as np
from PIL import Image, ImageDraw

here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, "out")
MP4 = os.path.join(out, "vortex-veo.mp4")
N   = int(sys.argv[1]) if len(sys.argv) > 1 else 16
CELL = int(sys.argv[2]) if len(sys.argv) > 2 else 256
END  = float(sys.argv[3]) if len(sys.argv) > 3 else None   # seconds; cap the clip (e.g. 5.5)

tmp = "/tmp/orbf"; os.system(f"rm -rf {tmp} && mkdir -p {tmp}")
tflag = f"-t {END}" if END else ""
os.system(f'ffmpeg -y -i "{MP4}" {tflag} {tmp}/%04d.png >/dev/null 2>&1')
allf = sorted(glob.glob(f"{tmp}/*.png"))
if not allf: print("no frames extracted"); sys.exit(1)
idx = [round(i*len(allf)/N) % len(allf) for i in range(N)]   # N evenly-spaced, seamless loop

def prep(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    s = min(w, h); im = im.crop(((w-s)//2, (h-s)//2, (w-s)//2+s, (h-s)//2+s))  # centre square (the orb)
    # key the white background from the corners (keeps the glass orb + interior)
    for c in [(0,0),(s-1,0),(0,s-1),(s-1,s-1)]:
        ImageDraw.floodfill(im, c, (255,0,255), thresh=28)
    a = np.asarray(im); bg = (a[...,0]==255)&(a[...,1]==0)&(a[...,2]==255); keep = ~bg
    k = keep.copy(); k[1:,:]&=keep[:-1,:]; k[:-1,:]&=keep[1:,:]; k[:,1:]&=keep[:,:-1]; k[:,:-1]&=keep[:,1:]
    rgba = np.dstack([a.astype(np.uint8), np.where(k,255,0).astype(np.uint8)])
    return Image.fromarray(rgba,"RGBA").resize((CELL,CELL), Image.LANCZOS)

frames = [prep(allf[i]) for i in idx]
framedir = os.path.join(here,"orb-frames"); os.makedirs(framedir, exist_ok=True)
for i,f in enumerate(frames,1): f.save(os.path.join(framedir,"orb-%02d.png"%i))

c0 = math.ceil(math.sqrt(N)); cols = next((c for c in range(c0, N+1) if N % c == 0), N); rows = N//cols
sheet = Image.new("RGBA",(cols*CELL, rows*CELL),(0,0,0,0))
for i,f in enumerate(frames): sheet.alpha_composite(f, ((i%cols)*CELL, (i//cols)*CELL))
sheet.save(os.path.join(out,"vortex-spritesheet.png"))

def onwhite(f): c=Image.new("RGBA",f.size,(255,255,255,255)); c.alpha_composite(f); return c.convert("RGB")
g=[onwhite(f) for f in frames]
g[0].save(os.path.join(out,"vortex.gif"),save_all=True,append_images=g[1:],duration=80,loop=0,disposal=2)
# review strip
rev=Image.new("RGB",(min(N,8)*160,160),(235,235,235))
for i in range(min(N,8)):
    t=onwhite(frames[i]).copy(); t.thumbnail((160,160)); rev.paste(t,(i*160,0))
rev.save("/tmp/orbsheet_review.png")
print(f"OK — {N} frames, {cols}x{rows} sheet ({cols*CELL}x{rows*CELL}), gif + frames")
