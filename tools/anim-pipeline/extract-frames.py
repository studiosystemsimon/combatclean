#!/usr/bin/env python3
# Slice the Seedance 4x4 sheet, key green bg + grey shadow to transparent, crop to the ball,
# resample to N looping frames, and emit: frames/, a horizontal strip, and a looping GIF + APNG.
import sys, os
import numpy as np
from PIL import Image

RAW = sys.argv[1] if len(sys.argv) > 1 else "raw-sheet.png"
N   = int(sys.argv[2]) if len(sys.argv) > 2 else 12
CELL_OUT = 256
GRID = 4
here = os.path.dirname(os.path.abspath(__file__))
framedir = os.path.join(here, "frames"); os.makedirs(framedir, exist_ok=True)
outdir = os.path.join(here, "out"); os.makedirs(outdir, exist_ok=True)

sheet = Image.open(RAW).convert("RGB")
W, H = sheet.size
cw, ch = W // GRID, H // GRID

def process_cell(cell):
    a = np.asarray(cell.convert("RGB")).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bright = (r + g + b) / 3.0
    # 1) chroma-green background + anti-aliased green fringe → transparent
    green = (g > 90) & (g - r > 22) & (g - b > 22)
    # 2) soft grey drop-shadow (low saturation, mid brightness) → transparent (keep black + white highlights)
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    grey = ((mx - mn) < 26) & (bright > 55) & (bright < 210)
    keep = ~(green | grey)
    # 3) erode the kept region by 1px to kill the last fringe pixels
    k = keep.copy()
    k[1:, :] &= keep[:-1, :]; k[:-1, :] &= keep[1:, :]
    k[:, 1:] &= keep[:, :-1]; k[:, :-1] &= keep[:, 1:]
    alpha = np.where(k, 255, 0).astype(np.uint8)
    rgba = np.dstack([a.astype(np.uint8), alpha])
    im = Image.fromarray(rgba, "RGBA")
    # crop to opaque bbox (the ball)
    bbox = im.getbbox()
    if bbox: im = im.crop(bbox)
    # square-pad, centered
    s = max(im.size); sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.alpha_composite(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq.resize((CELL_OUT, CELL_OUT), Image.LANCZOS)

# cells row-major 0..15
cells = []
for row in range(GRID):
    for col in range(GRID):
        cells.append(sheet.crop((col*cw, row*ch, col*cw+cw, row*ch+ch)))

total = len(cells)
idx = [round(i * total / N) % total for i in range(N)]     # N evenly-spaced → clean loop
frames = [process_cell(cells[i]) for i in idx]

for i, f in enumerate(frames, 1):
    f.save(os.path.join(framedir, "vortex-%02d.png" % i))

# horizontal strip (sprite sheet)
strip = Image.new("RGBA", (CELL_OUT * N, CELL_OUT), (0, 0, 0, 0))
for i, f in enumerate(frames):
    strip.alpha_composite(f, (i * CELL_OUT, 0))
strip.save(os.path.join(outdir, "crystal-vortex-strip.png"))

# looping GIF + APNG (on black so the transparent frames read)
def on_black(f):
    bg = Image.new("RGBA", f.size, (0, 0, 0, 255)); bg.alpha_composite(f); return bg.convert("RGB")
gif = [on_black(f) for f in frames]
gif[0].save(os.path.join(outdir, "crystal-vortex.gif"), save_all=True, append_images=gif[1:],
            duration=90, loop=0, disposal=2)
frames[0].save(os.path.join(outdir, "crystal-vortex.apng"), save_all=True, append_images=frames[1:],
               duration=90, loop=0)

# a static contact strip for review (frames in a row on a checker/black)
review = Image.new("RGB", (CELL_OUT * N, CELL_OUT), (12, 12, 12))
for i, f in enumerate(frames):
    review.paste(on_black(f), (i * CELL_OUT, 0))
review.save("/tmp/vortex_review.png")
print(f"OK — {N} frames, strip + gif + apng in out/, sampled cells {idx}")
