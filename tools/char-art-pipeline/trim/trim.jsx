#target photoshop
/*
 * trim.jsx  —  procedural die-cut trimmer for the char-art pipeline (combatclean)
 *
 * Pipeline (SIZE FIRST, then TREATMENT):
 *   A. FIT-TO-FRAME  — scale subject down + re-center for >= MIN_MARGIN px clearance.
 *   B. CLEAN CUT     — contiguous outside wand -> expand CUT_EXPAND (defringe) -> delete;
 *                      then each metadata pocket the same way. Result: a RAW transparent subject.
 *   C. SIZE          — the raw subject is emitted at each size:
 *                        • large  = the full canvas   -> <slug>_trim.png
 *                        • 256    = trim-to-content -> scale-to-fit -> center on a 256 square
 *   D. TREATMENT     — applied SEPARATELY per size, AFTER sizing: an ordered list of
 *                      outlines (colour + width) stroked outward from the silhouette.
 *                        • large uses treatmentLarge
 *                        • 256   uses treatmentSmall
 *                      (default = one 12px white outline = the old halo.)
 *
 * Treatments + pockets come from <root>/trim_meta.json (saved by the tool):
 *   { treatmentLarge:[{color,width}...], treatmentSmall:[...], images:{ "cat/name.png":{pockets,reg} } }
 * run-control (trim_run.json next to this script): { root, only }.
 * Originals never overwritten.
 */

(function () {
  // ---- defaults ----
  var ROOT        = "/Users/simonhill/combatclean/tools/char-art-pipeline/trim/assets";
  var MIN_MARGIN  = 14, TOLERANCE = 32, ANTI_ALIAS = true, SAMPLE_X = 1, SAMPLE_Y = 1;
  var CUT_EXPAND  = 1;          // px eaten off the silhouette to kill the anti-aliased white fringe
  var SIZE_256    = 256;
  var RUNCTL      = "/Users/simonhill/combatclean/tools/char-art-pipeline/trim/trim_run.json";
  var DEFAULT_TREATMENT = [{ color: "#ffffff", width: 12 }];
  var EXPORT_SIZES = {};   // per-category size override; DEFAULT is SIZE_256 for EVERY category

  function readJson(p){ var f=new File(p); if(!f.exists) return null; f.encoding="UTF-8"; f.open("r"); var s=f.read(); f.close(); try{return eval('('+s+')');}catch(e){return null;} }
  function endsWith(s,suf){ return s.length>=suf.length && s.substr(s.length-suf.length)===suf; }
  function totalWidth(t){ var s=0; for(var i=0;i<t.length;i++) s+=Number(t[i].width)||0; return s; }

  var run = readJson(RUNCTL), ONLY = null, ONLY_CAT = null;
  if (run){ if(run.root) ROOT=run.root; if(run.only) ONLY=String(run.only); if(run.onlyCat) ONLY_CAT=String(run.onlyCat); }
  var meta = readJson(ROOT + "/trim_meta.json") || {};
  var TREAT_LARGE = (meta.treatmentLarge && meta.treatmentLarge.length) ? meta.treatmentLarge : DEFAULT_TREATMENT;
  var TREAT_SMALL = (meta.treatmentSmall && meta.treatmentSmall.length) ? meta.treatmentSmall : DEFAULT_TREATMENT;

  // ---- shadow layer ----
  // A SEPARATE baked drop-shadow PNG (<name>_<sz>_shadow.png) emitted on the SAME sz×sz canvas as the
  // sprite, so the game's mergeStyle reg/scale/rotation transform lands it exactly behind the icon
  // (the static replacement for the per-tile CSS `filter: drop-shadow`). All params are in 256-src px
  // (tuned in docs/mockups/merge-shadow-parity.html). Override via trim_meta.json `shadow` block —
  // same config channel as treatmentSmall/Large (no parallel path).
  var SH = { enabled: true, blur: 8, dx: 0, dy: 20, opacity: 42, color: "#000000" };
  if (meta.shadow) {
    if (meta.shadow.enabled !== undefined) SH.enabled = meta.shadow.enabled;
    if (meta.shadow.blur    !== undefined) SH.blur    = Number(meta.shadow.blur);
    if (meta.shadow.dx      !== undefined) SH.dx      = Number(meta.shadow.dx);
    if (meta.shadow.dy      !== undefined) SH.dy      = Number(meta.shadow.dy);
    if (meta.shadow.opacity !== undefined) SH.opacity = Number(meta.shadow.opacity);
    if (meta.shadow.color   !== undefined) SH.color   = String(meta.shadow.color);
  }

  function magicWandPoint(x,y,tol,aa){
    var desc=new ActionDescriptor(), ref=new ActionReference();
    ref.putProperty(charIDToTypeID("Chnl"),charIDToTypeID("fsel")); desc.putReference(charIDToTypeID("null"),ref);
    var pt=new ActionDescriptor();
    pt.putUnitDouble(charIDToTypeID("Hrzn"),charIDToTypeID("#Pxl"),x);
    pt.putUnitDouble(charIDToTypeID("Vrtc"),charIDToTypeID("#Pxl"),y);
    desc.putObject(charIDToTypeID("T   "),charIDToTypeID("Pnt "),pt);
    desc.putInteger(charIDToTypeID("Tlrn"),tol); desc.putBoolean(charIDToTypeID("AntA"),aa);
    executeAction(charIDToTypeID("setd"),desc,DialogModes.NO);
  }
  function subjectBounds(doc){
    magicWandPoint(SAMPLE_X,SAMPLE_Y,TOLERANCE,ANTI_ALIAS);
    try{ doc.selection.invert(); }catch(e){ return null; }
    var b; try{ b=doc.selection.bounds; }catch(e){ return null; }
    try{ doc.selection.deselect(); }catch(e){}
    return { left:b[0].as("px"),top:b[1].as("px"),right:b[2].as("px"),bottom:b[3].as("px") };
  }
  function whiteFlatten(doc){
    var wl=doc.artLayers.add(); wl.name="__white";
    wl.move(doc.layers[doc.layers.length-1],ElementPlacement.PLACEAFTER);
    doc.activeLayer=wl; doc.selection.selectAll();
    var col=new SolidColor(); col.rgb.hexValue="FFFFFF";
    doc.selection.fill(col); doc.selection.deselect(); doc.flatten();
  }
  // select the active layer's opaque pixels (its transparency mask)
  function loadLayerAlpha(doc,layer){
    doc.activeLayer=layer;
    var desc=new ActionDescriptor();
    var refSel=new ActionReference(); refSel.putProperty(charIDToTypeID("Chnl"),charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("null"),refSel);
    var refT=new ActionReference(); refT.putEnumerated(charIDToTypeID("Chnl"),charIDToTypeID("Chnl"),charIDToTypeID("Trsp"));
    desc.putReference(charIDToTypeID("T   "),refT);
    executeAction(charIDToTypeID("setd"),desc,DialogModes.NO);
  }
  function fillSel(doc,hex){ var c=new SolidColor(); c.rgb.hexValue=(""+hex).replace("#",""); doc.selection.fill(c); }
  // stroke `treat` (inner->outer) outward from `subject`'s silhouette onto a layer below it
  function applyTreatment(doc,subject,treat){
    if(!treat||!treat.length) return;
    var fill=doc.artLayers.add(); fill.name="__treat";
    fill.move(subject,ElementPlacement.PLACEAFTER);       // below the subject
    var cum=totalWidth(treat);
    for(var i=treat.length-1;i>=0;i--){                   // outermost ring first
      loadLayerAlpha(doc,subject);
      if(cum>0){ try{ doc.selection.expand(new UnitValue(cum,"px")); }catch(e){} }
      doc.activeLayer=fill; fillSel(doc,treat[i].color);
      try{ doc.selection.deselect(); }catch(e){}
      cum-=Number(treat[i].width)||0;
    }
  }

  // Build a SEPARATE shadow PNG from a treated icon doc (sz×sz). Silhouette (subject + outline) ->
  // fill shadow colour -> gaussian blur -> offset -> layer opacity, on the SAME canvas as the sprite
  // so the game's mergeStyle transform aligns it. Never modifies the source doc.
  function exportShadow(iconDoc, outFile, sh){
    if(!sh || !sh.enabled) return false;
    var s=iconDoc.duplicate(); var ok=false;
    try{
      try{ s.mergeVisibleLayers(); }catch(e){}          // one layer, transparency preserved (incl. outline)
      var icon=s.artLayers[0];
      var shl=s.artLayers.add(); shl.name="__shadow";
      shl.move(icon, ElementPlacement.PLACEAFTER);       // below the icon
      loadLayerAlpha(s, icon);                            // select the icon silhouette
      s.activeLayer=shl; fillSel(s, sh.color);            // paint the silhouette onto the shadow layer
      try{ s.selection.deselect(); }catch(e){}
      icon.remove();                                      // leave only the silhouette
      s.activeLayer=shl;
      if(sh.blur>0){ try{ shl.applyGaussianBlur(sh.blur); }catch(e){} }
      if(sh.dx||sh.dy){ try{ shl.translate(sh.dx, sh.dy); }catch(e){} }
      try{ shl.opacity=Math.max(0,Math.min(100, sh.opacity)); }catch(e){}
      s.saveAs(outFile, png, true, Extension.LOWERCASE); ok=true;
    }catch(e){}
    s.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument=iconDoc;
    return ok;
  }

  var rootF=new Folder(ROOT); if(!rootF.exists){ alert("root not found:\n"+ROOT); return; }
  var cats=rootF.getFiles(function(f){ return (f instanceof Folder); });
  var prevDialogs=app.displayDialogs, prevUnits=app.preferences.rulerUnits;
  app.displayDialogs=DialogModes.NO; app.preferences.rulerUnits=Units.PIXELS;
  var png=new PNGSaveOptions(); png.interlaced=false;

  var processed=0, scaled=0, exported=0, shadows=0;

  for(var c=0;c<cats.length;c++){
    var cat=cats[c], catName=decodeURI(cat.name);
    if (ONLY_CAT && catName !== ONLY_CAT) continue;   // "clip all" is scoped to one category
    var files=cat.getFiles("*.png");
    for(var i=0;i<files.length;i++){
      if(!(files[i] instanceof File)) continue;
      var name=decodeURI(files[i].name);
      if(endsWith(name,"_trim.png")||endsWith(name,"_256.png")||endsWith(name,"_128.png")||endsWith(name,"_shadow.png")) continue;
      var rel=catName+"/"+name;
      if(ONLY && rel!==ONLY) continue;

      var doc=app.open(files[i]);
      if(doc.mode!==DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
      var W=doc.width.as("px"), H=doc.height.as("px");
      try{ doc.activeLayer.isBackgroundLayer=false; }catch(e){}

      // A. fit-to-frame
      var bb=subjectBounds(doc);
      if(bb){
        var mL=bb.left,mT=bb.top,mR=W-bb.right,mB=H-bb.bottom;
        if(Math.min(mL,mT,mR,mB)<MIN_MARGIN){
          var bw=bb.right-bb.left, bh=bb.bottom-bb.top;
          var scx=(bb.left+bb.right)/2, scy=(bb.top+bb.bottom)/2;
          var s=Math.min((W-2*MIN_MARGIN)/bw,(H-2*MIN_MARGIN)/bh,1.0);
          var lyr=doc.activeLayer;
          if(s<1.0) lyr.resize(s*100,s*100,AnchorPosition.MIDDLECENTER);
          lyr.translate(-(scx-W/2)*s,-(scy-H/2)*s);
          whiteFlatten(doc);
          try{ doc.activeLayer.isBackgroundLayer=false; }catch(e){}
          scaled++;
        }
      }

      // B. clean cut (outside + pockets), defringed, NO halo
      magicWandPoint(SAMPLE_X,SAMPLE_Y,TOLERANCE,ANTI_ALIAS);
      if(CUT_EXPAND>0){ try{ doc.selection.expand(new UnitValue(CUT_EXPAND,"px")); }catch(e){} }
      try{ doc.selection.clear(); }catch(e){}
      try{ doc.selection.deselect(); }catch(e){}
      var rec=(meta.images||{})[rel]||(meta.images||{})[name];
      var pk=(rec&&rec.pockets)?rec.pockets:[];
      for(var p=0;p<pk.length;p++){
        magicWandPoint(pk[p][0],pk[p][1],TOLERANCE,ANTI_ALIAS);
        if(CUT_EXPAND>0){ try{ doc.selection.expand(new UnitValue(CUT_EXPAND,"px")); }catch(e){} }
        try{ doc.selection.clear(); }catch(e){}
      }
      try{ doc.selection.deselect(); }catch(e){}

      var rawSubject=doc.activeLayer;

      // C+D. square exports (from the RAW subject) THEN small treatment. Every cat gets 256; merge chains also get 128.
      var MERGE_CATS = { magic:1, blade:1, range:1, "blade-gen":1, "range-gen":1, "magic-gen":1 };
      var sizes = MERGE_CATS[catName] ? [SIZE_256, 128] : [SIZE_256];
      for(var si=0; si<sizes.length; si++){
        var sz=sizes[si];
        var dup=doc.duplicate();                       // copy of the raw subject
        try{
          dup.trim(TrimType.TRANSPARENT);
          var tw=dup.width.as("px"), th=dup.height.as("px");
          var room=sz-2*(totalWidth(TREAT_SMALL)+2);    // leave space for the outline
          if(room<8) room=sz-4;
          var k=room/Math.max(tw,th);
          dup.resizeImage(UnitValue(tw*k,"px"),UnitValue(th*k,"px"),dup.resolution,ResampleMethod.BICUBICSHARPER);
          dup.resizeCanvas(UnitValue(sz,"px"),UnitValue(sz,"px"),AnchorPosition.MIDDLECENTER);
          applyTreatment(dup,dup.artLayers[0],TREAT_SMALL);
          dup.saveAs(new File(cat.fsName+"/"+name.replace(/\.png$/i,"_"+sz+".png")),png,true,Extension.LOWERCASE);
          exported++;
          // separate shadow layer on the SAME canvas (merge chains only — the merge board consumes it)
          if(SH.enabled && MERGE_CATS[catName]){
            var shf=new File(cat.fsName+"/"+name.replace(/\.png$/i,"_"+sz+"_shadow.png"));
            if(exportShadow(dup, shf, SH)) shadows++;
          }
        }catch(e){}
        dup.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument=doc;
      }

      // C+D. large size = full canvas, large treatment
      applyTreatment(doc,rawSubject,TREAT_LARGE);
      doc.saveAs(new File(cat.fsName+"/"+name.replace(/\.png$/i,"_trim.png")),png,true,Extension.LOWERCASE);
      doc.close(SaveOptions.DONOTSAVECHANGES);
      processed++;
    }
  }

  app.displayDialogs=prevDialogs; app.preferences.rulerUnits=prevUnits;
  return "trim.jsx done — trimmed "+processed+", rescaled "+scaled+", 256-exports "+exported+
         ", shadow-layers "+shadows+
         " | treatLarge="+TREAT_LARGE.length+" outline(s), treat256="+TREAT_SMALL.length+" outline(s)"+
         " | shadow="+(SH.enabled?("blur"+SH.blur+" dy"+SH.dy+" op"+SH.opacity):"off");
})();
