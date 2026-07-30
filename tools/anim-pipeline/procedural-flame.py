#!/usr/bin/env python3
# Incredibly-smooth procedural flame: upward-scrolling multi-octave (periodic) noise shaped into a
# flame, sheared by WIND, coloured by a HEAT ramp (white-hot core -> cyan -> electric blue -> violet
# tips). Seamless loop. Renders many frames -> mp4 @ 30fps. Blue soul-flame palette (matches the asset).
import os, numpy as np
from PIL import Image, ImageFilter

here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, "out"); os.makedirs(out, exist_ok=True)
W, H = 512, 512        # square → the orb renders as a true circle
FRAMES = 60
WIND = 0.05            # gentle wind (flame mainly rises UP)
FLAME_H = 0.46         # flame height as fraction of H
cx = 0.5; cy = 0.66; R = 0.17   # circular orb body — sits low-centre with a flame rising above it

# periodic multi-octave noise (summed sines): loops in time, scrolls upward
COMPS = [(1,2,1.0),(2,3,0.6),(1,4,0.5),(3,5,0.35),(2,6,0.28),(4,7,0.2)]
PH = [0.7,2.1,3.9,1.3,5.0,0.4]
def noise(Xn, Yn, t):
    s = np.zeros_like(Xn); amp = 0.0
    for (fx, fy, a),ph in zip(COMPS, PH):
        s += a*np.sin(2*np.pi*(fx*Xn + fy*Yn - fy*t) + ph); amp += a
    return s/amp                                   # [-1,1], seamless over t in [0,1)

# heat -> RGBA ramp (position, r,g,b,a)
STOPS = np.array([
    [0.00,  10, 12, 26,   0],
    [0.07, 110, 30, 180,  70],   # violet tip
    [0.20,  60, 60, 235, 165],   # indigo
    [0.40,  45,120,255, 225],    # electric blue
    [0.62,  70,210,255, 255],    # cyan
    [0.82, 190,245,255, 255],    # pale cyan
    [1.00, 255,255,255, 255],    # white-hot core
], float)
def ramp(heat):
    pos = STOPS[:,0]
    return np.stack([np.interp(heat, pos, STOPS[:,i]) for i in range(1,5)], axis=-1)

ys, xs = np.mgrid[0:H,0:W].astype(np.float32)
Xn = xs/W; Yn = ys/H

def frame(i):
    t = i/FRAMES
    # --- circular ORB body: a clean round glowing sphere (no flat bottom) ---
    d = np.sqrt((Xn - cx)**2 + (Yn - cy)**2)
    orb = np.clip(1.0 - d/R, 0, 1) ** 0.65
    # --- flame ONLY ABOVE the orb top, rising UP as licking wisps ---
    top_orb = cy - R                                 # orb's top edge
    h = np.clip((top_orb - Yn)/FLAME_H, 0, 1)        # 0 at orb top -> 1 at flame tip
    # smooth vertical mask: flame fades IN from the orb's centre upward, and is 0 below (no flat cut / no bottom column)
    fmask = np.clip((cy - Yn)/(R*0.95), 0, 1); fmask = fmask*fmask*(3 - 2*fmask)
    lick = 0.08*np.sin(2*np.pi*t + h*5.0)*h          # side-to-side licking (more at the tips)
    wind = WIND*(h**1.6)*(0.6 + 0.4*np.sin(2*np.pi*t))
    xc = Xn - (lick + wind)
    width = R*0.66*(1.0 - 0.72*h) + 1e-3             # wisps NARROWER than the orb, taper upward
    bell = np.exp(-((xc - cx)**2)/(2*width**2))
    n = 0.5 + 0.5*noise(xc*2.6, Yn*1.9, t)           # turbulent tongue detail, scrolls UP
    vfall = np.clip(1.0 - h*0.45, 0, 1)
    frag = (h**1.05) * (1.0 - n) * 1.25              # higher + low-noise burns away => licks + fragments/embers
    heat_flame = np.clip(bell*vfall*(0.55 + 0.9*n) - frag, 0, 1) * fmask
    heat = np.clip(np.maximum(orb*1.10, heat_flame), 0, 1)
    heat = heat**0.85
    # FLAT ANIME CEL bands by heat (distance from the hot core): violet tip -> indigo -> blue -> cyan -> white
    PAL = np.array([[0,0,0,0],[125,35,190,255],[70,60,235,255],[55,130,255,255],[100,218,255,255],[242,249,255,255]], float)
    THR = [0.12, 0.30, 0.48, 0.66, 0.84]
    band = np.zeros(heat.shape, int)
    for th in THR: band += (heat > th).astype(int)
    rgba = PAL[band].astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    # dark cel outline around the flame silhouette
    amask = Image.fromarray(((rgba[...,3] > 0).astype(np.uint8) * 255))
    dil = np.asarray(amask.filter(ImageFilter.MaxFilter(5)))
    outline = (dil > 0) & (rgba[...,3] == 0)
    canvas = Image.new("RGBA", (W, H), (8, 9, 16, 255))
    canvas.alpha_composite(img.filter(ImageFilter.GaussianBlur(6)))   # subtle bloom
    cn = np.array(canvas); cn[outline] = [16, 12, 36, 255]; canvas = Image.fromarray(cn, "RGBA")
    canvas.alpha_composite(img)
    return canvas.convert("RGB")

import shutil
tmp = "/tmp/pf"; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
frames = [frame(i) for i in range(FRAMES)]
idx = 0
for _ in range(3):                                  # ~6s of the seamless loop
    for f in frames: f.save(f"{tmp}/{idx:04d}.png"); idx += 1
# strip for still review
rev = Image.new("RGB",(160*8, 213),(8,9,16))
for j,i in enumerate(range(0,FRAMES,max(1,FRAMES//8))[:8]):
    t=frames[i].copy(); t.thumbnail((160,213)); rev.paste(t,(j*160,0))
rev.save("/tmp/pflame_review.png")
os.system(f'ffmpeg -y -framerate 30 -i {tmp}/%04d.png -c:v libx264 -pix_fmt yuv420p "{out}/flame-procedural.mp4" >/tmp/pfffmpeg.log 2>&1')
print("OK — procedural flame:", os.path.join(out,"flame-procedural.mp4"))
