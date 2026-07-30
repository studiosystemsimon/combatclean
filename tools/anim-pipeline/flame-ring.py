#!/usr/bin/env python3
# ANIME SOUL-FIRE aura for the skull orb. This is the FLAME LAYER ONLY: transparent
# everywhere except the flames; video-to-mockup.py alpha-composites it over the orb.
#
# Technique (2D real-time-VFX recipe, not a bead ring):
#   * Tileable 3D value-noise FBM (angle x height x time) that SCROLLS UPWARD -> flames rise.
#   * Flame potential  d = (1 - hn) + turbulence  -> thresholded into licking tongues that
#     taper and FRAGMENT into embers near the tips (the noise carves the region apart there).
#   * Skull-hugging polar frame (measured from the face centre) so flame laps the skull edge,
#     rises up the sides and licks over the cranium; buoyancy weight kills the bottom.
#   * Heat -> colour ramp: white-hot -> electric blue -> violet -> magenta -> hot red tip.
#   * Baked additive GLOW (blurred warm halo) UNDER a crisp anti-aliased flame silhouette.
#   * Rising EMBER sparks that fade out at the top; phase loops so 39 -> 0 is seamless.
# Seamless loop: every time term is periodic in t=i/N (grid wraps in t; y-scroll is integer).
#
# Usage: flame-ring.py [N=40] [outdir=/tmp/flames]
import os, sys, math, shutil
import numpy as np
from PIL import Image, ImageFilter

N   = int(sys.argv[1]) if len(sys.argv) > 1 else 40
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/flames"
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)

# ---------------------------------------------------------------- geometry (256-space)
W = H = 256
CX, CY   = 128.0, 128.0      # orb centre
R_OUT    = 82.0             # cavity radius (keep every flame pixel inside the glass wall)
FCX, FCY = 128.0, 136.0     # skull-face centre
FRX, FRY = 54.0, 63.0       # face-protect ellipse radii (flames fade to 0 inside it)
LAP      = 5.0              # px the flame base laps INSIDE the skull edge

# ---------------------------------------------------------------- tunables
BASE_LEN = 40.0            # max tongue reach (px) at full upward weight
TURB     = 1.55           # turbulence amplitude (carves tongues + tip fragmentation)
NY       = 1.9            # noise periods across a tongue's height
VSPEED   = 1              # upward scroll (INTEGER -> seamless); grid periods per loop
SWAY     = 0.045         # lateral lick amount (fraction of the ring)
EMBERS   = 46
SEED     = 7

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)

# ---------------------------------------------------------------- tileable value-noise FBM
# grids wrap on all 3 axes -> perfectly loopable in angle, height and time.
def make_grid(pt, ps, seed):
    return np.random.default_rng(seed).random((pt, ps, ps)).astype(np.float32)

def _smooth(f):            # smootherstep for interpolation weights
    return f*f*f*(f*(f*6.0-15.0)+10.0)

def sample(grid, ax, ay, at):
    pt, ps, _ = grid.shape
    fx = ax*ps; fy = ay*ps; ft = at*pt
    x0 = np.floor(fx); y0 = np.floor(fy); t0 = np.floor(ft)
    dx = _smooth(fx-x0); dy = _smooth(fy-y0); dt = _smooth(ft-t0)
    x0 = x0.astype(np.int64)%ps; y0 = y0.astype(np.int64)%ps; t0 = t0.astype(np.int64)%pt
    x1 = (x0+1)%ps; y1 = (y0+1)%ps; t1 = (t0+1)%pt
    def g(ti,yi,xi): return grid[ti,yi,xi]
    c00 = g(t0,y0,x0)*(1-dx)+g(t0,y0,x1)*dx; c10 = g(t0,y1,x0)*(1-dx)+g(t0,y1,x1)*dx
    c01 = g(t1,y0,x0)*(1-dx)+g(t1,y0,x1)*dx; c11 = g(t1,y1,x0)*(1-dx)+g(t1,y1,x1)*dx
    c0  = c00*(1-dy)+c10*dy; c1 = c01*(1-dy)+c11*dy
    return c0*(1-dt)+c1*dt

# 3 octaves; wrap in time (pt) AND angle -> INTEGER freqs so the loop + ring tile seamlessly.
OCT = [
    (make_grid(4,  12, SEED+1), 1, 0.55),
    (make_grid(4,  24, SEED+2), 2, 0.30),
    (make_grid(6,  48, SEED+3), 4, 0.15),
]
def fbm(ax, ay, at):
    s = np.zeros_like(ax); amp = 0.0
    for grid, fr, a in OCT:
        s += a*sample(grid, (ax*fr) % 1.0, ay*fr, at)     # fr integer => seamless in angle & y-scroll
        amp += a
    return s/amp                                        # [0,1]

# ---------------------------------------------------------------- heat -> colour ramp
# heat 1 (hot base) -> 0 (cool tip): white-hot / electric-blue / violet / magenta / hot-red
STOPS = [
    (0.00, ( 90,  8, 32)),   # coolest ember tip: deep crimson
    (0.16, (224, 34, 66)),   # hot red
    (0.34, (255, 58,150)),   # pink-magenta
    (0.52, (176, 60,244)),   # violet / purple
    (0.72, ( 74,120,255)),   # electric blue
    (0.90, (150,205,255)),   # blue-white
    (1.00, (238,248,255)),   # white-hot core
]
def ramp(heat):
    r = np.zeros_like(heat); g = np.zeros_like(heat); b = np.zeros_like(heat)
    for (h0,c0),(h1,c1) in zip(STOPS[:-1], STOPS[1:]):
        m = (heat>=h0)&(heat<=h1)
        u = np.clip((heat-h0)/(h1-h0+1e-6), 0, 1)
        r[m] = (c0[0]+(c1[0]-c0[0])*u)[m]
        g[m] = (c0[1]+(c1[1]-c0[1])*u)[m]
        b[m] = (c0[2]+(c1[2]-c0[2])*u)[m]
    return np.stack([r,g,b], -1)

def smoothstep(a, b, x):
    t = np.clip((x-a)/(b-a+1e-9), 0, 1); return t*t*(3-2*t)

# ---------------------------------------------------------------- masks (static)
rad_c = np.sqrt((xs-CX)**2 + (ys-CY)**2)                    # from orb centre
cav   = smoothstep(R_OUT, R_OUT-9.0, rad_c)                # 1 inside cavity -> 0 at wall
fe    = np.sqrt(((xs-FCX)/FRX)**2 + ((ys-FCY)/FRY)**2)     # 1 on face ellipse
face  = smoothstep(0.90, 1.14, fe)                          # 0 in face -> 1 outside (laps edge)

# skull-hugging polar frame (measured from the FACE centre)
dxf = xs-FCX; dyf = ys-FCY
radf = np.sqrt(dxf*dxf + dyf*dyf) + 1e-3
ang  = np.arctan2(dyf, dxf)                                 # 0=+x, +pi/2=down, -pi/2=up
an   = (ang/(2*math.pi)) % 1.0                              # normalised angle (wraps)
re   = 1.0/np.sqrt((np.cos(ang)/FRX)**2 + (np.sin(ang)/FRY)**2)   # face-ellipse radius @ ang
Rb   = re - LAP                                             # flame base radius (laps inside edge)
upw  = np.clip(0.5 - 0.78*np.sin(ang), 0.0, 1.35)          # buoyancy: strong up, dead at bottom
Lmax = BASE_LEN*(0.30 + 0.92*upw)                          # per-angle tongue reach
present = 0.20 + 0.80*upw                                   # bottom flames dim/absent

def frame(i):
    t = i/N
    sway = SWAY*np.sin(2*math.pi*t)                         # whole-ring lateral drift (loops)
    ax = (an + sway + 0.5) % 1.0
    hn = np.clip((radf - Rb)/np.maximum(Lmax,1.0), 0.0, 1.4)  # 0 at skull edge -> 1 at tip
    ay = hn*NY - VSPEED*t                                   # UPWARD scroll (integer speed)
    n  = fbm(ax, ay, t)                                     # [0,1] turbulence
    # flame potential: solid at base, carved to fragments (embers) at the tip; flick strongest up top
    d = (1.0 - hn) + (n - 0.5)*TURB*(0.30 + 1.15*hn)
    d = d*present
    d = np.where(radf > Rb-2.0, d, 0.0)                     # nothing inside the skull surface
    d *= cav*face
    # heat for colour: hot at base, cooler with height, jittered by the same noise
    heat = np.clip((1.0 - 0.86*hn) + (n-0.5)*0.30, 0.0, 1.0)
    heat = np.where(hn < 0.14, np.maximum(heat, 0.93), heat)   # white-hot core at the base
    rgb  = ramp(heat)
    a_flame = smoothstep(0.02, 0.16, d)                    # crisp but 1-2px anti-aliased edge
    a_flame *= smoothstep(0.0, 0.10, d)                    # kill the faint outer haze -> crisp

    # ---- baked GLOW (warm blurred halo under the crisp flame) ----
    lum = (a_flame*(0.5+0.5*heat)*255).astype(np.uint8)
    gl  = Image.fromarray(lum).filter(ImageFilter.GaussianBlur(6.5))
    gl  = np.asarray(gl).astype(np.float32)/255.0
    glow_rgb = ramp(np.clip(heat*0.8+0.25, 0, 1))
    ga = np.clip(gl*0.60, 0, 0.55)                          # capped halo alpha

    # ---- composite glow (under) then crisp flame (over), premultiplied alpha-over ----
    out_rgb = glow_rgb*ga[...,None]
    out_a   = ga
    fa = a_flame
    out_rgb = fa[...,None]*rgb + (1-fa)[...,None]*out_rgb
    out_a   = fa + (1-fa)*out_a

    # ---- rising EMBER sparks (bright dots that fade at the top, phase loops) ----
    eb = np.zeros((H, W, 3), np.float32); eba = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(SEED*13+1)
    for k in range(EMBERS):
        a0   = rng.random()
        the  = a0*2*math.pi
        uw   = max(0.0, 0.5 - 0.78*math.sin(the))
        if uw < 0.12:      # no embers off the dead bottom
            continue
        spd  = 0.65 + 0.6*rng.random()
        ph   = (t*spd + a0*7.31) % 1.0                      # rise phase (loops)
        rre  = 1.0/math.sqrt((math.cos(the)/FRX)**2 + (math.sin(the)/FRY)**2)
        drift= 10.0 + 34.0*uw
        r    = rre - 2.0 + ph*drift
        px   = FCX + r*math.cos(the) + 3.5*math.sin(6.28*ph + a0*9)
        py   = FCY + r*math.sin(the) - ph*ph*10.0*uw        # extra screen-up lift
        if math.hypot(px-CX, py-CY) > R_OUT-1.5:
            continue
        al   = math.sin(math.pi*ph)**1.3 * (0.55+0.45*rng.random())
        sz   = (1.3 + 1.7*(1-ph))
        hh   = np.clip(0.72 - 0.5*ph + 0.15*rng.random(), 0, 1)
        col  = ramp(np.array([hh]))[0]
        yy, xx = np.mgrid[max(0,int(py-4)):min(H,int(py+5)), max(0,int(px-4)):min(W,int(px+5))]
        if xx.size == 0: continue
        g = np.exp(-(((xx-px)**2+(yy-py)**2)/(2*sz*sz)))*al
        ry0, ry1 = yy.min(), yy.max()+1; rx0, rx1 = xx.min(), xx.max()+1
        eba[ry0:ry1, rx0:rx1] = np.maximum(eba[ry0:ry1, rx0:rx1], g)
        for c in range(3):
            eb[ry0:ry1, rx0:rx1, c] = np.maximum(eb[ry0:ry1, rx0:rx1, c], g*col[c])
    eba *= cav
    # additive-ish over the flame (embers are bright sparks)
    out_rgb = out_rgb + eb*0.9
    out_a   = np.clip(out_a + eba*0.9, 0, 1)

    arr = np.zeros((H, W, 4), np.uint8)
    arr[...,:3] = np.clip(out_rgb, 0, 255).astype(np.uint8)
    arr[..., 3] = np.clip(out_a*255, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

for i in range(N):
    frame(i).save(os.path.join(OUT, f"f{i:03d}.png"))

# review strip (flames alone on dark)
strip = Image.new("RGB", (128*6, 128), (14, 15, 20))
for j, i in enumerate([round(k*N/6) % N for k in range(6)]):
    tile = Image.open(os.path.join(OUT, f"f{i:03d}.png")).convert("RGBA")
    c = Image.new("RGBA", (256,256), (14,15,20,255)); c.alpha_composite(tile)
    r = c.convert("RGB"); r.thumbnail((128,128)); strip.paste(r, (j*128,0))
strip.save("/tmp/flamering_review.png")
print(f"OK - {N} anime soul-fire frames in {OUT}")
