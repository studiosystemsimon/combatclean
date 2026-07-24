#!/usr/bin/env python3
"""Contact sheet of ALL enemies in classes.tsv, from the shared trim tool's enemies frames (white bg), labeled.
Usage: python3 sheet.py [out.png] [cols]"""
import sys, pathlib
from PIL import Image, ImageDraw, ImageFont
ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT.parent / "char-art-pipeline" / "trim" / "assets" / "enemies"   # shared trim tool's enemies category
OUTP = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "contact_sheet.png"
COLS = int(sys.argv[2]) if len(sys.argv) > 2 else 8
slugs = [ln.split("\t",1)[0].strip() for ln in (ROOT/"classes.tsv").read_text().splitlines() if ln.strip() and not ln.startswith("#")]
CELL, PAD, LH = 300, 12, 28
rows = (len(slugs)+COLS-1)//COLS
W = COLS*CELL + (COLS+1)*PAD
H = rows*(CELL+LH) + (rows+1)*PAD
sheet = Image.new("RGB",(W,H),(232,232,236))
draw = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype("/System/Library/Fonts/SFNSRounded.ttf",22)
except Exception: font = ImageFont.load_default()
for i,c in enumerate(slugs):
    p = SRC/f"{c}.png"
    cx = PAD + (i%COLS)*(CELL+PAD)
    cy = PAD + (i//COLS)*(CELL+LH+PAD)
    cell = Image.new("RGB",(CELL,CELL),(255,255,255))
    if p.exists():
        im = Image.open(p).convert("RGB"); im.thumbnail((CELL-6,CELL-6),Image.LANCZOS)
        cell.paste(im,((CELL-im.size[0])//2,(CELL-im.size[1])//2))
    else:
        draw2=ImageDraw.Draw(cell); draw2.text((10,10),"(missing)",fill=(200,60,60),font=font)
    sheet.paste(cell,(cx,cy))
    lbl=f"{i+1}. {c.upper()}"; tb=draw.textbbox((0,0),lbl,font=font)
    draw.text((cx+(CELL-(tb[2]-tb[0]))//2,cy+CELL+2),lbl,fill=(30,30,34),font=font)
sheet.save(OUTP); print(OUTP, sheet.size)
