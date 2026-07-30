#!/usr/bin/env python3
# REPEATABLE PIPELINE: Veo video -> frames -> Photoshop die-cut -> looping APNG -> board mockup HTML.
# Usage: video-to-mockup.py <video.mp4> [endSecs=5.5] [frames=30] [tol=20]
import sys, os, glob, base64, subprocess
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(here, "..", ".."))
MP4  = sys.argv[1]
END  = float(sys.argv[2]) if len(sys.argv) > 2 else 5.5
N    = int(sys.argv[3]) if len(sys.argv) > 3 else 30
TOL  = int(sys.argv[4]) if len(sys.argv) > 4 else 20   # Photoshop white-wand tolerance (lower keeps the glass rim)
MS   = int(sys.argv[5]) if len(sys.argv) > 5 else 60    # per-frame ms in the APNG loop (higher = slower playback)
APX  = int(sys.argv[6]) if len(sys.argv) > 6 else 128   # APNG output px per side (higher = crisper tile)
SHARP= int(sys.argv[7]) if len(sys.argv) > 7 else 0     # unsharp-mask percent (0=off) — counters Veo's soft-fuzz
FLAMEDIR = sys.argv[8] if len(sys.argv) > 8 else ""     # dir of crisp cel-flame PNG frames to composite over the orb
LOOPMODE = int(sys.argv[9]) if len(sys.argv) > 9 else 0  # 1 = find the seamless wrap point on the skull's bob
BOB      = int(sys.argv[10]) if len(sys.argv) > 10 else 0 # procedural skull-bob amplitude in px (center-weighted, perfect sine loop)
OUTLINE  = int(sys.argv[11]) if len(sys.argv) > 11 else 0 # 1 = apply the trim tool's merge-tile outline treatment (Photoshop)
SPARKLE  = int(sys.argv[12]) if len(sys.argv) > 12 else 0 # number of sparkle particles drifting off the orb (0=off)

for d in ("/tmp/vraw","/tmp/orbwhite","/tmp/orbtrans"):
    os.system(f"rm -rf {d} && mkdir -p {d}")

# 1) extract white-bg frames (centre-square crop, 256px)
os.system(f'ffmpeg -y -i "{MP4}" -t {END} /tmp/vraw/%04d.png >/dev/null 2>&1')
allf = sorted(glob.glob("/tmp/vraw/*.png"))
if not allf: print("FAIL: no frames from", MP4); sys.exit(1)
if LOOPMODE:
    import numpy as _np
    def _sig(p):                                        # centre band = the (outlined) skull, flames average out at 64px
        a = _np.asarray(Image.open(p).convert("L").resize((64,64)), float); return a[14:58, 8:56]
    s0 = _sig(allf[0]); lo = int(len(allf)*0.35); hi = int(len(allf)*0.98)
    best = min(range(lo, hi), key=lambda L: float(((_sig(allf[L]) - s0)**2).mean())) if hi > lo else len(allf)-1
    idx = [round(i*best/N) for i in range(N)]           # sample one bob cycle [0,best] -> frame N-1 -> 0 is one step
    print(f"[loop] seamless wrap at frame {best}/{len(allf)}")
else:
    idx = [round(i*len(allf)/N) % len(allf) for i in range(N)]
for j,i in enumerate(idx,1):
    im = Image.open(allf[i]).convert("RGB"); w,h = im.size; s = min(w,h)
    im.crop(((w-s)//2,(h-s)//2,(w-s)//2+s,(h-s)//2+s)).resize((256,256),Image.LANCZOS).save(f"/tmp/orbwhite/orb-{j:02d}.png")

# 2) Photoshop die-cut (contiguous white wand from the corners; stops at the glass outline)
jsx = f'''#target photoshop
(function(){{
  var IN=new Folder("/tmp/orbwhite"), OUT=new Folder("/tmp/orbtrans"); if(!OUT.exists) OUT.create();
  var TOL={TOL}, AA=true, EXPAND=1;
  function wand(x,y){{ var d=new ActionDescriptor(), r=new ActionReference();
    r.putProperty(charIDToTypeID("Chnl"),charIDToTypeID("fsel")); d.putReference(charIDToTypeID("null"),r);
    var p=new ActionDescriptor(); p.putUnitDouble(charIDToTypeID("Hrzn"),charIDToTypeID("#Pxl"),x);
    p.putUnitDouble(charIDToTypeID("Vrtc"),charIDToTypeID("#Pxl"),y);
    d.putObject(charIDToTypeID("T   "),charIDToTypeID("Pnt "),p);
    d.putInteger(charIDToTypeID("Tlrn"),TOL); d.putBoolean(charIDToTypeID("AntA"),AA);
    executeAction(charIDToTypeID("setd"),d,DialogModes.NO); }}
  var files=IN.getFiles("*.png");
  for(var i=0;i<files.length;i++){{
    var doc=app.open(files[i]);
    if(doc.mode!=DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
    try{{ doc.activeLayer.isBackgroundLayer=false; }}catch(e){{}}
    var W=doc.width.as("px"), H=doc.height.as("px"), cn=[[1,1],[W-2,1],[1,H-2],[W-2,H-2]];
    for(var c=0;c<cn.length;c++){{ wand(cn[c][0],cn[c][1]);
      if(EXPAND>0){{ try{{doc.selection.expand(new UnitValue(EXPAND,"px"));}}catch(e){{}} }}
      try{{ doc.selection.clear(); }}catch(e){{}} try{{ doc.selection.deselect(); }}catch(e){{}} }}
    var o=new File(OUT.fsName+"/"+files[i].name), opt=new PNGSaveOptions(); opt.interlaced=false;
    doc.saveAs(o,opt,true,Extension.LOWERCASE); doc.close(SaveOptions.DONOTSAVECHANGES);
  }}
}})();'''
open("/tmp/orb-trim.jsx","w").write(jsx)
subprocess.run(["osascript","-e",'tell application "Adobe Photoshop 2022" to do javascript (read (POSIX file "/tmp/orb-trim.jsx") as «class utf8»)'],
               capture_output=True)
trans = sorted(glob.glob("/tmp/orbtrans/*.png"))
if not trans: print("FAIL: Photoshop produced no frames"); sys.exit(1)

# 3) final frames: [flames] -> circle-clamp + procedural bob -> [outline treatment] -> APNG
import numpy as np, math
base = [Image.open(f).convert("RGBA") for f in trans]                 # die-cut orb frames (256)
if FLAMEDIR:                                                          # composite crisp cel flames over the orb
    fl = sorted(glob.glob(os.path.join(FLAMEDIR, "*.png")))
    for i in range(len(base)):
        fr = Image.open(fl[i % len(fl)]).convert("RGBA")
        if fr.size != base[i].size: fr = fr.resize(base[i].size, Image.LANCZOS)
        base[i].alpha_composite(fr)

# orb circle from frame 0 -> clean silhouette (kills stray flame nubs) + center-weighted bob mask
w0, h0 = base[0].size
_a0 = np.asarray(base[0])[..., 3] > 40; _ys, _xs = np.where(_a0)
ocx = (_xs.min()+_xs.max())/2.0; ocy = (_ys.min()+_ys.max())/2.0
orad = max(_xs.max()-_xs.min(), _ys.max()-_ys.min())/2.0
yy, xx = np.mgrid[0:h0, 0:w0].astype(np.float32)
rr = np.sqrt((xx-ocx)**2 + (yy-ocy)**2); inside = rr <= (orad-0.5); xi = xx.astype(int)
bm = (np.clip(1.0 - rr/(0.60*orad), 0, 1)); bm = bm*bm*(3-2*bm)       # 1 at centre -> 0 at rim
for i, fr in enumerate(base):
    arr = np.asarray(fr).astype(np.float32)
    if BOB > 0:
        disp = BOB*math.sin(2*math.pi*i/len(base))                   # pure sine -> perfect loop
        srcy = yy - disp*bm
        y0 = np.floor(srcy).astype(int); wgt = (srcy-y0)[..., None]
        y0c = np.clip(y0, 0, h0-1); y1c = np.clip(y0+1, 0, h0-1)
        arr = arr[y0c, xi]*(1-wgt) + arr[y1c, xi]*wgt
    a = arr[..., 3]; a[~inside] = 0; arr[..., 3] = a                  # clamp to a clean orb circle
    base[i] = Image.fromarray(arr.clip(0,255).astype("uint8"), "RGBA")

# OUTLINE: the trim tool's merge-tile treatment (Photoshop) — same treatmentSmall config, applied per frame
if OUTLINE:
    import json as _json
    tm = os.path.join(here, "..", "char-art-pipeline", "trim", "assets", "trim_meta.json")
    # Measured from the real _256 merge tiles: a solid BLACK outline, no white border (~5px at 256).
    treat = [{"color": "#000000", "width": 5}]
    os.system("rm -rf /tmp/orbfinal /tmp/orbout && mkdir -p /tmp/orbfinal /tmp/orbout")
    for i, b in enumerate(base): b.save("/tmp/orbfinal/f%03d.png" % i)
    tjs = "[" + ",".join('{color:"%s",width:%d}' % (t["color"], int(t["width"])) for t in treat) + "]"
    tjsx = '''#target photoshop
(function(){
  var IN=new Folder("/tmp/orbfinal"), OUT=new Folder("/tmp/orbout"); if(!OUT.exists) OUT.create();
  var SZ=256, TREAT=%s;
  function tw_(t){var s=0;for(var i=0;i<t.length;i++)s+=Number(t[i].width)||0;return s;}
  function la(doc,l){doc.activeLayer=l;var d=new ActionDescriptor();var rs=new ActionReference();rs.putProperty(charIDToTypeID("Chnl"),charIDToTypeID("fsel"));d.putReference(charIDToTypeID("null"),rs);var rt=new ActionReference();rt.putEnumerated(charIDToTypeID("Chnl"),charIDToTypeID("Chnl"),charIDToTypeID("Trsp"));d.putReference(charIDToTypeID("T   "),rt);executeAction(charIDToTypeID("setd"),d,DialogModes.NO);}
  function fs(doc,hex){var c=new SolidColor();c.rgb.hexValue=(""+hex).replace("#","");doc.selection.fill(c);}
  function treatIt(doc,sub,t){if(!t||!t.length)return;var f=doc.artLayers.add();f.name="__t";f.move(sub,ElementPlacement.PLACEAFTER);var cum=tw_(t);for(var i=t.length-1;i>=0;i--){la(doc,sub);if(cum>0){try{doc.selection.expand(new UnitValue(cum,"px"));}catch(e){}}doc.activeLayer=f;fs(doc,t[i].color);try{doc.selection.deselect();}catch(e){}cum-=Number(t[i].width)||0;}}
  app.displayDialogs=DialogModes.NO; app.preferences.rulerUnits=Units.PIXELS;
  var png=new PNGSaveOptions(); png.interlaced=false; var files=IN.getFiles("*.png");
  for(var i=0;i<files.length;i++){var doc=app.open(files[i]);try{doc.activeLayer.isBackgroundLayer=false;}catch(e){}
    doc.trim(TrimType.TRANSPARENT); var w=doc.width.as("px"),h=doc.height.as("px");
    var room=SZ-2*(tw_(TREAT)+2); if(room<8)room=SZ-4; var k=room/Math.max(w,h);
    doc.resizeImage(UnitValue(w*k,"px"),UnitValue(h*k,"px"),doc.resolution,ResampleMethod.BICUBICSHARPER);
    doc.resizeCanvas(UnitValue(SZ,"px"),UnitValue(SZ,"px"),AnchorPosition.MIDDLECENTER);
    treatIt(doc,doc.artLayers[0],TREAT);
    doc.saveAs(new File(OUT.fsName+"/"+files[i].name),png,true,Extension.LOWERCASE); doc.close(SaveOptions.DONOTSAVECHANGES);}
})();''' % tjs
    open("/tmp/treat-frames.jsx","w").write(tjsx)
    subprocess.run(["osascript","-e",'tell application "Adobe Photoshop 2022" to do javascript (read (POSIX file "/tmp/treat-frames.jsx") as «class utf8»)'], capture_output=True)
    outf = sorted(glob.glob("/tmp/orbout/*.png"))
    if outf: base = [Image.open(f).convert("RGBA") for f in outf]
    else: print("WARN: outline treatment produced no frames — using un-outlined")

# SPARKLE: a few small particles drift off the orb, briefly spiking scale/brightness (twinkle). Seamless loop.
if SPARKLE > 0:
    rng = np.random.default_rng(20260730)
    Wc = base[0].size[0]
    _A = np.asarray(base[0])[..., 3] > 40; _y, _x = np.where(_A)
    ocx = (_x.min()+_x.max())/2.0; ocy = (_y.min()+_y.max())/2.0
    orb = max(_x.max()-_x.min(), _y.max()-_y.min())/2.0
    # 4-point twinkle sprite (white RGBA, 64px)
    S = 64; sy, sx = np.mgrid[0:S, 0:S].astype(float)
    ndx = (sx-S/2)/(S/2); ndy = (sy-S/2)/(S/2); r2 = ndx*ndx + ndy*ndy
    core = np.exp(-r2/0.02)
    spk = np.exp(-(ndy**2)/0.0016)*np.clip(1-np.abs(ndx),0,1)**2 + np.exp(-(ndx**2)/0.0016)*np.clip(1-np.abs(ndy),0,1)**2
    starA = np.clip(core + 0.85*spk, 0, 1)
    STAR = np.dstack([np.full((S,S),255.0), np.full((S,S),255.0), np.full((S,S),255.0), starA*255.0])
    TINT = {'w':(255,255,255), 'p':(255,190,230), 'b':(200,225,255)}
    parts = []
    for _p in range(SPARKLE):
        parts.append(dict(sx=ocx + orb*rng.uniform(-0.45,0.45),   # start across the BASE (bottom) of the orb
                          sy=ocy + orb*rng.uniform(0.55,0.92),
                          rise=orb*rng.uniform(1.05,1.85),          # rise UP through/over the orb
                          dx=orb*rng.uniform(-0.12,0.12),
                          ph=rng.uniform(0,1), base=rng.uniform(11,17), tint=rng.choice(['w','w','w','p','b']),
                          sp=sorted(rng.uniform(0.15,0.85, size=int(rng.integers(1,3))).tolist())))
    for i in range(len(base)):
        t = i/len(base); ov = Image.new("RGBA", (Wc, Wc), (0,0,0,0))
        for pp in parts:
            lf = (t + pp['ph']) % 1.0
            env = max(0.0, min(lf/0.15, (1-lf)/0.25, 1.0))          # fade in/out -> seamless
            if env <= 0: continue
            spike = 1.0
            for sp in pp['sp']:
                d = abs(((lf - sp + 0.5) % 1.0) - 0.5)               # wrapped phase distance
                spike += 1.9*math.exp(-(d/0.035)**2)                 # brief scale/brightness pop
            size = max(2, int(pp['base']*spike))
            px = pp['sx'] + pp['dx']*lf
            py = pp['sy'] - pp['rise']*lf                            # rise from the base upward
            col = TINT[str(pp['tint'])]
            arr = STAR.copy(); arr[...,0]*=col[0]/255.0; arr[...,1]*=col[1]/255.0; arr[...,2]*=col[2]/255.0
            arr[...,3] *= env*(0.32 + 0.68*min(1.0,(spike-1)/1.6))   # dim baseline, bright on twinkle
            spr = Image.fromarray(arr.clip(0,255).astype('uint8'),"RGBA").resize((size*2,size*2), Image.LANCZOS)
            ov.alpha_composite(spr, (int(px-size), int(py-size)))
        base[i] = Image.alpha_composite(base[i], ov)

frames = [b.resize((APX, APX), Image.LANCZOS) for b in base]
if SHARP > 0:
    from PIL import ImageFilter
    frames = [f.filter(ImageFilter.UnsharpMask(radius=1.6, percent=SHARP, threshold=1)) for f in frames]
apng = os.path.join(here,"out","special-0.png"); os.makedirs(os.path.dirname(apng),exist_ok=True)
frames[0].save(apng, save_all=True, append_images=frames[1:], duration=MS, loop=0, disposal=2)

# 4) board mockup HTML (self-contained; APNG embedded)
uri = "data:image/png;base64," + base64.b64encode(open(apng,"rb").read()).decode()
tpl = open(os.path.join(here,"mockup-template.html")).read()
html = tpl.replace("__URI__", uri)
mock = os.path.join(GAME,"docs","mockups","s-tile-mockup.html"); os.makedirs(os.path.dirname(mock),exist_ok=True)
open(mock,"w").write(html)
print(f"OK — {len(frames)} frames | APNG {apng} | mockup {mock}")
