#!/usr/bin/env python3
# Assemble the anime per-frame set: flood-key the white bg from the corners (keeps the enclosed
# bright core), erode 1px, crop, square-pad, resize, and emit strip + looping GIF + APNG on dark.
import os, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
src = sorted(glob.glob(os.path.join(here, "aframes", "af-*.png")))
framedir = os.path.join(here, "frames"); os.makedirs(framedir, exist_ok=True)
outdir = os.path.join(here, "out"); os.makedirs(outdir, exist_ok=True)
CELL = 256

def key_white(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    mark = (255, 0, 255)
    for c in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]:
        ImageDraw.floodfill(im, c, mark, thresh=32)      # border-connected near-white → marker
    a = np.asarray(im)
    bg = (a[..., 0] == 255) & (a[..., 1] == 0) & (a[..., 2] == 255)
    keep = ~bg
    k = keep.copy()                                       # erode 1px to kill white halo fringe
    k[1:, :] &= keep[:-1, :]; k[:-1, :] &= keep[1:, :]
    k[:, 1:] &= keep[:, :-1]; k[:, :-1] &= keep[:, 1:]
    alpha = np.where(k, 255, 0).astype(np.uint8)
    rgba = np.dstack([a.astype(np.uint8), alpha])
    img = Image.fromarray(rgba, "RGBA")
    bbox = img.getbbox()
    if bbox: img = img.crop(bbox)
    s = max(img.size); sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.alpha_composite(img, ((s-img.width)//2, (s-img.height)//2))
    return sq.resize((CELL, CELL), Image.LANCZOS)

frames = [key_white(p) for p in src]
for i, f in enumerate(frames, 1):
    f.save(os.path.join(framedir, "soulanime-%02d.png" % i))

def on_dark(f):
    bg = Image.new("RGBA", f.size, (10, 10, 14, 255))
    glow = f.filter(ImageFilter.GaussianBlur(10))         # mild glow, keeps the flat look
    bg.alpha_composite(glow); bg.alpha_composite(f)
    return bg.convert("RGB")

strip = Image.new("RGBA", (CELL*len(frames), CELL), (0, 0, 0, 0))
for i, f in enumerate(frames): strip.alpha_composite(f, (i*CELL, 0))
strip.save(os.path.join(outdir, "soulanime-strip.png"))

gif = [on_dark(f) for f in frames]
gif[0].save(os.path.join(outdir, "soulanime.gif"), save_all=True, append_images=gif[1:], duration=90, loop=0, disposal=2)
frames[0].save(os.path.join(outdir, "soulanime.apng"), save_all=True, append_images=frames[1:], duration=90, loop=0)

review = Image.new("RGB", (CELL*len(frames), CELL), (12, 12, 16))
for i, f in enumerate(frames): review.paste(on_dark(f), (i*CELL, 0))
review.save("/tmp/anime_review.png")
print("OK — %d anime frames, strip+gif+apng in out/" % len(frames))
