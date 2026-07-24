#target photoshop
/*
 * trim.jsx  —  procedural die-cut trimmer for the char-art pipeline (combatclean)
 *
 * Driven by the standalone asset tool. Control files:
 *   - trim_run.json   (next to this script) : { root, only, contract_px }
 *   - <root>/trim_meta.json                 : { contract_px, images:{ "cat/name.png":{pockets:[[x,y]...]} } }
 *
 * Walks every category subfolder under <root> (heroes / enemies / icons / ...).
 * Per source *.png (skipping *_trim.png / *_256.png; and all but `only` when set):
 *   A. FIT-TO-FRAME  — scale subject down + re-center for >= MIN_MARGIN px clearance.
 *   B. TRIM          — contiguous outside wand -> contract CONTRACT_PX -> delete (halo).
 *   C. POCKETS       — each clicked point (mapped through the fit transform):
 *                      contiguous wand -> contract -> delete (cut internal fills).
 *   -> save  <cat>/<name>_trim.png   (transparent halo asset)
 *   D. EXPORT SIZES  — for categories in EXPORT_SIZES, also produce a square asset
 *                      via Photoshop Image Size (trim to content -> fit -> center):
 *   -> save  <cat>/<name>_<size>.png (e.g. heroes -> _256.png)
 * Originals are never overwritten.
 */

(function () {
    // ---- defaults (overridden by trim_run.json when the tool drives it) --
    var ROOT         = "/Users/simonhill/combatclean/tools/char-art-pipeline/trim/assets";
    var CONTRACT_PX  = 12;
    var MIN_MARGIN   = 14;
    var TOLERANCE    = 32;
    var ANTI_ALIAS   = true;
    var SAMPLE_X     = 1, SAMPLE_Y = 1;
    var RUNCTL       = "/Users/simonhill/combatclean/tools/char-art-pipeline/trim/trim_run.json";
    // per-category square export via Photoshop scaling (add categories here)
    var EXPORT_SIZES = { "heroes": 256 };
    // ----------------------------------------------------------------------

    function readJson(path) {
        var f = new File(path);
        if (!f.exists) return null;
        f.encoding = "UTF-8"; f.open("r"); var s = f.read(); f.close();
        try { return eval('(' + s + ')'); } catch (e) { return null; }
    }
    function endsWith(s, suf) { return s.length >= suf.length && s.substr(s.length - suf.length) === suf; }

    var run = readJson(RUNCTL), ONLY = null;
    if (run) {
        if (run.root) ROOT = run.root;
        if (run.contract_px !== undefined && run.contract_px !== null) CONTRACT_PX = Number(run.contract_px);
        if (run.only) ONLY = String(run.only);
    }
    var meta = readJson(ROOT + "/trim_meta.json");

    function magicWandPoint(x, y, tol, aa) {
        var desc = new ActionDescriptor(), ref = new ActionReference();
        ref.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
        desc.putReference(charIDToTypeID("null"), ref);
        var pt = new ActionDescriptor();
        pt.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), x);
        pt.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), y);
        desc.putObject(charIDToTypeID("T   "), charIDToTypeID("Pnt "), pt);
        desc.putInteger(charIDToTypeID("Tlrn"), tol);
        desc.putBoolean(charIDToTypeID("AntA"), aa);
        executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
    }
    function subjectBounds(doc) {
        magicWandPoint(SAMPLE_X, SAMPLE_Y, TOLERANCE, ANTI_ALIAS);
        try { doc.selection.invert(); } catch (e) { return null; }
        var b; try { b = doc.selection.bounds; } catch (e) { return null; }
        try { doc.selection.deselect(); } catch (e) {}
        return { left:b[0].as("px"), top:b[1].as("px"), right:b[2].as("px"), bottom:b[3].as("px") };
    }
    function whiteFlatten(doc) {
        var wl = doc.artLayers.add(); wl.name = "__white";
        wl.move(doc.layers[doc.layers.length - 1], ElementPlacement.PLACEAFTER);
        doc.activeLayer = wl;
        doc.selection.selectAll();
        var col = new SolidColor(); col.rgb.hexValue = "FFFFFF";
        doc.selection.fill(col); doc.selection.deselect();
        doc.flatten();
    }

    var rootF = new Folder(ROOT);
    if (!rootF.exists) { alert("root not found:\n" + ROOT); return; }
    var cats = rootF.getFiles(function (f) { return (f instanceof Folder); });

    var prevDialogs = app.displayDialogs, prevUnits = app.preferences.rulerUnits;
    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;
    var pngOpts = new PNGSaveOptions(); pngOpts.interlaced = false;

    var processed = 0, scaled = 0, cut = 0, exported = 0;

    for (var c = 0; c < cats.length; c++) {
        var cat = cats[c], catName = decodeURI(cat.name);
        var files = cat.getFiles("*.png");
        for (var i = 0; i < files.length; i++) {
            if (!(files[i] instanceof File)) continue;
            var name = decodeURI(files[i].name);
            if (endsWith(name, "_trim.png") || endsWith(name, "_256.png")) continue;
            var rel = catName + "/" + name;
            if (ONLY && rel !== ONLY) continue;

            var doc = app.open(files[i]);
            if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
            var W = doc.width.as("px"), H = doc.height.as("px");
            try { doc.activeLayer.isBackgroundLayer = false; } catch (e) {}

            var s = 1.0, tx = 0, ty = 0;

            // A. fit-to-frame
            var bb = subjectBounds(doc);
            if (bb) {
                var mL = bb.left, mT = bb.top, mR = W - bb.right, mB = H - bb.bottom;
                if (Math.min(mL, mT, mR, mB) < MIN_MARGIN) {
                    var bw = bb.right - bb.left, bh = bb.bottom - bb.top;
                    var scx = (bb.left + bb.right) / 2, scy = (bb.top + bb.bottom) / 2;
                    s  = Math.min((W - 2 * MIN_MARGIN) / bw, (H - 2 * MIN_MARGIN) / bh, 1.0);
                    tx = -(scx - W / 2) * s; ty = -(scy - H / 2) * s;
                    var lyr = doc.activeLayer;
                    if (s < 1.0) lyr.resize(s * 100, s * 100, AnchorPosition.MIDDLECENTER);
                    lyr.translate(tx, ty);
                    whiteFlatten(doc);
                    try { doc.activeLayer.isBackgroundLayer = false; } catch (e) {}
                    scaled++;
                }
            }

            // B. outside trim
            magicWandPoint(SAMPLE_X, SAMPLE_Y, TOLERANCE, ANTI_ALIAS);
            try { doc.selection.contract(new UnitValue(CONTRACT_PX, "px")); } catch (e) {}
            try { doc.selection.clear(); } catch (e) {}
            try { doc.selection.deselect(); } catch (e) {}

            // C. internal pockets
            var recImgs = (meta && meta.images) ? meta.images : {};
            var rec = recImgs[rel] || recImgs[name];  // accept "cat/name" or bare "name"
            var pk = (rec && rec.pockets) ? rec.pockets : [];
            for (var p = 0; p < pk.length; p++) {
                var qx = W / 2 + (pk[p][0] - W / 2) * s + tx;
                var qy = H / 2 + (pk[p][1] - H / 2) * s + ty;
                magicWandPoint(qx, qy, TOLERANCE, ANTI_ALIAS);
                try { doc.selection.contract(new UnitValue(CONTRACT_PX, "px")); } catch (e) {}
                try { doc.selection.clear(); cut++; } catch (e) {}
            }
            try { doc.selection.deselect(); } catch (e) {}

            // save the trimmed halo asset (full canvas)
            var outTrim = new File(cat.fsName + "/" + name.replace(/\.png$/i, "_trim.png"));
            doc.saveAs(outTrim, pngOpts, true, Extension.LOWERCASE);
            processed++;

            // D. square export via Photoshop Image Size (only for configured categories)
            var sz = EXPORT_SIZES[catName];
            if (sz) {
                try {
                    doc.trim(TrimType.TRANSPARENT);                 // crop to content (subject + halo)
                    var tw = doc.width.as("px"), th = doc.height.as("px");
                    var k = sz / Math.max(tw, th);
                    doc.resizeImage(UnitValue(tw * k, "px"), UnitValue(th * k, "px"),
                                    doc.resolution, ResampleMethod.BICUBICSHARPER);
                    doc.resizeCanvas(UnitValue(sz, "px"), UnitValue(sz, "px"), AnchorPosition.MIDDLECENTER);
                    var out256 = new File(cat.fsName + "/" + name.replace(/\.png$/i, "_" + sz + ".png"));
                    doc.saveAs(out256, pngOpts, true, Extension.LOWERCASE);
                    exported++;
                } catch (e) {}
            }

            doc.close(SaveOptions.DONOTSAVECHANGES);
        }
    }

    app.displayDialogs = prevDialogs;
    app.preferences.rulerUnits = prevUnits;
    return "trim.jsx done — trimmed " + processed + ", rescaled " + scaled +
           ", pockets " + cut + ", square-exports " + exported + ", halo " + CONTRACT_PX + "px";
})();
