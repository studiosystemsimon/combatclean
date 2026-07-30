#!/usr/bin/env python3
"""
asset_tool_server.py — standalone click tool for the char-art TRIM stage.

Serves asset_tool.html + the images under --root (grouped by category subfolder:
heroes / enemies / icons / ...), and reads/writes trim_meta.json in --root.
You drop points ONLY on internal areas that need the fill removed (enclosed
background pockets). 0 points on an image = default trim.

Run:  python3 asset_tool_server.py                 # root = ./assets, port 8790
      python3 asset_tool_server.py --root assets --port 8790
Then open http://localhost:8790
"""
import argparse, json, os, re, sys, subprocess, http.server, socketserver, threading, signal, time, shutil
from urllib.parse import urlparse, unquote, parse_qs

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))          # .../trim
PIPELINE = os.path.dirname(ROOT_DIR)                            # .../char-art-pipeline
ENEMY_PIPELINE = os.path.join(os.path.dirname(PIPELINE), "enemy-art-pipeline")   # sibling enemy gen pipeline
ENEMY_AREAS = {"mossbog", "gloomwood", "boneyard", "emberfall", "frostvault", "dragons-ascent"}
MERGE_PIPELINE = os.path.join(os.path.dirname(PIPELINE), "merge-icon-pipeline")  # sibling merge-icon gen pipeline
MERGE_CATS = {"magic", "blade", "range", "blade-gen", "range-gen", "magic-gen"}
GEAR_PIPELINE = os.path.join(os.path.dirname(PIPELINE), "gear-pipeline")         # sibling gear gen pipeline
GEAR_CATS = {"armor", "weapons", "accessories"}
LOOT_PIPELINE = os.path.join(os.path.dirname(PIPELINE), "loot-pipeline")         # sibling loot gen pipeline
LOOT_CATS = {"chests", "sacks"}
GAME_ROOT = os.path.dirname(os.path.dirname(PIPELINE))          # repo root (for the post-merge-export build)
GEN_SH   = os.path.join(PIPELINE, "generate.sh")
JSX     = os.path.join(ROOT_DIR, "trim.jsx")
RUNCTL  = os.path.join(ROOT_DIR, "trim_run.json")
PS_APP  = "Adobe Photoshop 2022"

# in-flight generation jobs: slug -> subprocess.Popen
JOBS = {}

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")

def start_generate(slug, subject, overrides=""):
    """Deploy generate.sh via a LOGIN shell (so claude / fortis-ai-gateway are on PATH),
    detached. generate.sh writes logs/gen-<slug>.log and stages heroes/<slug>.png.
    `overrides` = critical elements that outrank the base prompt (e.g. 'lava skin, cornrow hair')."""
    env = os.environ.copy()
    env["FORCE"] = "1"
    if subject: env["GEN_SUBJECT"] = subject
    if overrides: env["GEN_OVERRIDES"] = overrides
    cmd = ["/bin/zsh", "-lc",
           'cd %s && exec bash generate.sh %s' % (_q(PIPELINE), _q(slug))]
    JOBS[slug] = subprocess.Popen(cmd, env=env, cwd=PIPELINE,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  start_new_session=True)

def _q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"

def _meta_meaningful(d):
    """True if the metadata holds real per-image work (registration / portrait / pockets)."""
    imgs = (d or {}).get("images", {}) or {}
    return any((v or {}).get("reg") or (v or {}).get("portrait") or (v or {}).get("pockets")
               for v in imgs.values())

def write_meta(meta_path, data):
    """Persist trim_meta.json SAFELY.
      1. HARD GUARD — refuse to overwrite a file that already holds per-image values with an
         empty/valueless payload (this is what wiped work twice). Returns without writing.
      2. one-time permanent `.rescue` snapshot of the last meaningful state.
      3. rolling `.bak` -> `.bak2` so several bad writes in a row still can't destroy the data."""
    import shutil
    try:
        if os.path.exists(meta_path):
            try: cur = json.load(open(meta_path))
            except Exception: cur = {}
            if _meta_meaningful(cur) and not _meta_meaningful(data):
                return {"ok": False, "skipped": "refused: empty payload would wipe existing metadata"}
            if _meta_meaningful(cur) and not os.path.exists(meta_path + ".rescue"):
                shutil.copyfile(meta_path, meta_path + ".rescue")
            if os.path.exists(meta_path + ".bak"): shutil.copyfile(meta_path + ".bak", meta_path + ".bak2")
            shutil.copyfile(meta_path, meta_path + ".bak")
    except Exception:
        pass
    with open(meta_path, "w") as f:
        json.dump(data, f, indent=2)
    return {"ok": True}

def delete_character(root, meta_path, cat, name):
    """Delete a character's TOOL assets: source png + _trim + _256, its trim_meta entry, and its
    classes.tsv row. Does NOT touch the game config (that's export's domain)."""
    cat = os.path.basename(cat); name = os.path.basename(name)
    base = re.sub(r"\.png$", "", name, flags=re.I)
    deleted = []
    cdir = os.path.join(root, cat)
    for fn in (base + ".png", base + "_trim.png", base + "_256.png"):
        fp = os.path.normpath(os.path.join(cdir, fn))
        if fp.startswith(os.path.normpath(root)) and os.path.isfile(fp):
            try: os.remove(fp); deleted.append(cat + "/" + fn)
            except OSError: pass
    tsv = os.path.join(PIPELINE, "classes.tsv")   # drop its roster row so it isn't regenerated
    try:
        if os.path.exists(tsv):
            lines = open(tsv).readlines()
            kept = [ln for ln in lines if ln.split("\t", 1)[0].strip().lower() != base.lower()]
            if len(kept) != len(lines):
                open(tsv, "w").writelines(kept); deleted.append("classes.tsv row")
    except OSError: pass
    try:
        if os.path.exists(meta_path):
            meta = json.load(open(meta_path)); key = cat + "/" + base + ".png"
            if isinstance(meta.get("images"), dict) and key in meta["images"]:
                del meta["images"][key]; write_meta(meta_path, meta); deleted.append("meta " + key)
    except Exception: pass
    return {"ok": True, "deleted": deleted}

def run_export(no_build, dry=False, category=None):
    """Run export-to-game.mjs via a LOGIN shell (node/npm/git-lfs on PATH). Parses the
    trailing 'RESULT {json}' summary line."""
    # merge/gen categories route to the sibling merge-icon pipeline (all chains, no per-slug classification).
    if category in MERGE_CATS:
        if dry:
            return {"ok": True, "result": {"refreshed": [], "created": [], "anchored": 0, "errors": []}}
        build = "" if no_build else " && cd %s && npm run build" % _q(GAME_ROOT)
        cmd = ["/bin/zsh", "-lc", "cd %s && node export-to-game.mjs%s" % (_q(MERGE_PIPELINE), build)]
    else:
        extra = ""
        if dry: extra += " --dry-run"
        elif no_build: extra += " --no-build"
        extra += _cat_flag(category)
        cmd = ["/bin/zsh", "-lc", "cd %s && exec node export-to-game.mjs%s" % (_q(PIPELINE), extra)]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        out = (p.stdout or "") + (p.stderr or "")
        result = None
        for line in reversed(out.strip().splitlines()):
            if line.startswith("RESULT "):
                try: result = json.loads(line[len("RESULT "):]);
                except Exception: pass
                break
        return {"ok": p.returncode == 0, "result": result, "output": out[-4000:]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "export timed out"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# background export (the build takes ~1-2 min — run detached + poll, don't hold the fetch open)
EXPORT_LOG = "/tmp/combatclean_export.log"
EXPORT = {"proc": None}
def _cat_flag(category):
    c = re.sub(r"[^a-z0-9_-]", "", str(category or "").lower())
    return (" --cat " + c) if c else ""
def start_export(no_build, category=None):
    # merge/gen categories → sibling merge-icon pipeline (copies art + rewrites assets.json for ALL
    # chains), then the game build so the asset registry validates + bakes. Others → char-art export.
    if category in MERGE_CATS:
        build = "" if no_build else " && cd %s && npm run build" % _q(GAME_ROOT)
        inner = "cd %s && node export-to-game.mjs%s" % (_q(MERGE_PIPELINE), build)
    else:
        extra = (" --no-build" if no_build else "") + _cat_flag(category)
        inner = "cd %s && node export-to-game.mjs%s" % (_q(PIPELINE), extra)
    # Wrap the whole chain in a group so the redirect captures EVERY command's output (the export's
    # RESULT line + the build) — a trailing `>LOG` would otherwise bind only to the last command.
    cmd = ["/bin/zsh", "-lc", "{ %s ; } >%s 2>&1" % (inner, _q(EXPORT_LOG))]
    EXPORT["proc"] = subprocess.Popen(cmd, start_new_session=True)
def export_status():
    p = EXPORT["proc"]
    full = ""
    try:
        with open(EXPORT_LOG, errors="replace") as f: full = f.read()
    except OSError: pass
    result = None
    # Scan the WHOLE log for the RESULT line — the merge export emits it before the (voluminous)
    # build output, so a 4000-char tail would miss it. The client still gets a capped `log`.
    for line in reversed(full.strip().splitlines()):
        if line.startswith("RESULT "):
            try: result = json.loads(line[len("RESULT "):])
            except Exception: pass
            break
    rc = p.poll() if p else None
    return {"started": bool(p), "running": bool(p) and rc is None,
            "done": bool(p) and rc is not None, "returncode": rc, "result": result, "log": full[-4000:]}

# batch regen — a QUEUE of jobs (enemy area / merge chain / checked subset), run one at a time by a
# background worker. Each job tracks progress (tiles done / total) and can be cancelled. The UI shows
# a progress bar per job in the bottom-right panel; finished jobs auto-prune after a few seconds.
REGEN_LOGDIR = "/tmp/combatclean_regen"
os.makedirs(REGEN_LOGDIR, exist_ok=True)
REGEN_JOBS = []                 # ordered: queued → running → done/error (then auto-pruned)
REGEN_LOCK = threading.Lock()
_REGEN_SEQ = [0]
_REGEN_WORKER_STARTED = [False]

def _regen_plan(root, category):
    """(cwd, tsv_rel, env) for a category's gen.sh invocation — same routing as before."""
    env = os.environ.copy(); env["FORCE"] = "1"
    if category in ENEMY_AREAS:
        tsv = "rosters/%s.tsv" % category; env["TSV"] = tsv; env["OUT"] = os.path.join(root, category); cwd = ENEMY_PIPELINE
    elif category in MERGE_CATS:
        tsv = "rosters/%s.tsv" % category; env["TSV"] = tsv; env["OUT"] = os.path.join(root, category); cwd = MERGE_PIPELINE
    elif category in GEAR_CATS:
        tsv = "rosters/%s.tsv" % category; env["TSV"] = tsv; env["OUT"] = os.path.join(root, category); cwd = GEAR_PIPELINE
    elif category in LOOT_CATS:
        tsv = "rosters/%s.tsv" % category; env["TSV"] = tsv; env["OUT"] = os.path.join(root, category); cwd = LOOT_PIPELINE
    else:                                             # heroes → hero pipeline
        tsv = "rosters/classes.tsv"; cwd = PIPELINE
    return cwd, tsv, env

def _roster_count(cwd, tsv):
    try:
        n = 0
        with open(os.path.join(cwd, tsv)) as f:
            for ln in f:
                s = ln.strip()
                if s and not s.startswith("#"): n += 1
        return max(n, 1)
    except OSError:
        return 1

def _count_done(logpath):
    """How many tiles gen.sh has finished so far (each OK/WARN/FAIL line = one tile)."""
    try:
        with open(logpath, errors="replace") as f:
            return sum(1 for ln in f if re.match(r'^(OK|WARN|FAIL)\b', ln))
    except OSError:
        return 0

def _kill_group(proc):
    try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception:
        try: proc.kill()
        except Exception: pass

def enqueue_regen(root, category, slugs, overrides=""):
    slugs = [slugify(s) for s in (slugs or []) if slugify(s)]
    cwd, tsv, env = _regen_plan(root, category)
    if overrides: env["OVERRIDES"] = overrides
    _REGEN_SEQ[0] += 1; jid = _REGEN_SEQ[0]
    job = {"id": jid, "slugs": slugs,
           "label": category + ((" · " + ", ".join(slugs)) if slugs else " · all"),
           "status": "queued", "total": (len(slugs) if slugs else _roster_count(cwd, tsv)), "done": 0,
           "cwd": cwd, "env": env, "log": os.path.join(REGEN_LOGDIR, "job-%d.log" % jid),
           "proc": None, "cancelled": False, "ended": None}
    with REGEN_LOCK: REGEN_JOBS.append(job)
    return {"ok": True, "id": jid, "label": job["label"]}

def cancel_regen(jid):
    with REGEN_LOCK:
        job = next((j for j in REGEN_JOBS if j["id"] == jid), None)
        if not job: return {"ok": False, "error": "no such job"}
        job["cancelled"] = True
        if job["proc"] and job["status"] == "running": _kill_group(job["proc"])
        REGEN_JOBS[:] = [j for j in REGEN_JOBS if j["id"] != jid]   # X = remove the row immediately
    return {"ok": True}

def regen_queue():
    now = time.time()
    with REGEN_LOCK:
        REGEN_JOBS[:] = [j for j in REGEN_JOBS
                         if not (j["ended"] and j["status"] != "running" and now - j["ended"] > 4)]
        jobs = []
        for j in REGEN_JOBS:
            total = max(j["total"], 1); done = min(j["done"], total)
            jobs.append({"id": j["id"], "label": j["label"], "status": j["status"],
                         "total": total, "done": done,
                         "progress": 1.0 if j["status"] == "done" else round(done / total, 3)})
    return {"jobs": jobs}

def _regen_worker():
    while True:
        with REGEN_LOCK:
            job = next((j for j in REGEN_JOBS if j["status"] == "queued"), None)
        if job is None:
            time.sleep(0.4); continue
        if job.get("cancelled"):
            with REGEN_LOCK: REGEN_JOBS[:] = [j for j in REGEN_JOBS if j is not job]
            continue
        job["status"] = "running"
        slug_args = "".join(" " + _q(s) for s in job["slugs"])
        cmd = ["/bin/zsh", "-lc", "cd %s && exec bash gen.sh%s >%s 2>&1" % (_q(job["cwd"]), slug_args, _q(job["log"]))]
        try:
            open(job["log"], "w").close()
            job["proc"] = subprocess.Popen(cmd, env=job["env"], start_new_session=True)
        except Exception as e:
            job["status"] = "error"; job["ended"] = time.time(); continue
        while True:
            rc = job["proc"].poll()
            job["done"] = _count_done(job["log"])
            if job.get("cancelled"):
                _kill_group(job["proc"])
                with REGEN_LOCK: REGEN_JOBS[:] = [j for j in REGEN_JOBS if j is not job]
                break
            if rc is not None:
                job["returncode"] = rc
                if rc == 0: job["done"] = job["total"]
                job["status"] = "done" if rc == 0 else "error"
                job["ended"] = time.time()
                break
            time.sleep(0.4)

def start_regen_worker():
    if not _REGEN_WORKER_STARTED[0]:
        _REGEN_WORKER_STARTED[0] = True
        threading.Thread(target=_regen_worker, daemon=True).start()

# ---- Regenerate ×N variants: generate N candidates into a temp dir (self-anchored to the current
# tile, never overwriting it) so the user can pick a favourite from a popup ----
VARIANTS_DIR = "/tmp/combatclean_variants"
VARIANTS = {"slug": None, "cat": None, "total": 0, "done": 0, "status": "idle", "ready": [], "cells": {}, "procs": [], "cancel": False}
VARIANTS_LOCK = threading.Lock()

def _variants_worker(root, cat, slug, n, overrides):
    vdir = os.path.join(VARIANTS_DIR, slug)
    os.makedirs(vdir, exist_ok=True)
    for f in os.listdir(vdir):                                   # clear old candidates
        if f.startswith("cand-") and f.endswith(".png"):
            try: os.remove(os.path.join(vdir, f))
            except OSError: pass
    cwd, tsv, env0 = _regen_plan(root, cat)
    src = os.path.join(root, cat, slug + ".png")                 # self-anchor each variant to the current tile
    cells = {i: "running" for i in range(1, n + 1)}
    with VARIANTS_LOCK:
        VARIANTS.update(slug=slug, cat=cat, total=n, done=0, status="running",
                        ready=[], cells=dict(cells), procs=[], cancel=False)
    procs = {}
    for i in range(1, n + 1):                                    # launch ALL n concurrently, each its OWN output dir
        outdir = os.path.join(vdir, "out-%d" % i)
        os.makedirs(outdir, exist_ok=True)
        try: os.remove(os.path.join(outdir, slug + ".png"))     # ensure no stale file → no duplicate on failure
        except OSError: pass
        env = env0.copy(); env["FORCE"] = "1"; env["OUT"] = outdir
        var = ((overrides + " ") if overrides else "") + \
              ("Variation %d — keep the SAME item, subject and rarity, but vary the pose, angle, composition and minor details to give a DISTINCT alternative." % i)
        env["OVERRIDES"] = var
        if os.path.isfile(src): env["REF"] = src
        logp = os.path.join(vdir, "gen-%d.log" % i)
        cmd = ["/bin/zsh", "-lc", "cd %s && exec bash gen.sh %s >%s 2>&1" % (_q(cwd), _q(slug), _q(logp))]
        try:
            procs[i] = subprocess.Popen(cmd, env=env, start_new_session=True)
        except Exception:
            cells[i] = "failed"
    with VARIANTS_LOCK: VARIANTS["procs"] = list(procs.values())
    handled = set()
    while len(handled) < len(procs):
        with VARIANTS_LOCK: cancelled = VARIANTS["cancel"]
        if cancelled: break
        for i, p in procs.items():
            if i in handled or p.poll() is None: continue
            handled.add(i)
            out = os.path.join(vdir, "out-%d" % i, slug + ".png")
            if os.path.isfile(out):
                try:
                    shutil.copy(out, os.path.join(vdir, "cand-%d.png" % i))
                    cells[i] = "done"
                    with VARIANTS_LOCK: VARIANTS["ready"].append(i)
                except OSError:
                    cells[i] = "failed"
            else:
                cells[i] = "failed"
        with VARIANTS_LOCK:
            VARIANTS["cells"] = dict(cells); VARIANTS["done"] = len(handled)
        time.sleep(0.4)
    with VARIANTS_LOCK:
        VARIANTS["cells"] = dict(cells)
        VARIANTS["status"] = "cancelled" if VARIANTS["cancel"] else "done"
        VARIANTS["procs"] = []

def start_variants(root, cat, slug, n, overrides):
    with VARIANTS_LOCK:
        if VARIANTS["status"] == "running":
            return {"ok": False, "error": "variants already generating"}
    threading.Thread(target=_variants_worker, args=(root, cat, slug, max(1, min(n, 12)), overrides), daemon=True).start()
    return {"ok": True, "slug": slug, "n": n}

def variants_status():
    with VARIANTS_LOCK:
        return {"slug": VARIANTS["slug"], "cat": VARIANTS["cat"], "total": VARIANTS["total"],
                "done": VARIANTS["done"], "status": VARIANTS["status"],
                "ready": list(VARIANTS["ready"]), "cells": {str(k): v for k, v in VARIANTS["cells"].items()}}

def cancel_variants():
    with VARIANTS_LOCK:
        VARIANTS["cancel"] = True
        for p in VARIANTS["procs"]: _kill_group(p)
    return {"ok": True}

def pick_variant(root, cat, slug, index):
    cand = os.path.join(VARIANTS_DIR, slug, "cand-%d.png" % index)
    if not os.path.isfile(cand):
        return {"ok": False, "error": "no such candidate"}
    dst = os.path.join(root, cat, slug + ".png")
    try:
        shutil.copy(cand, dst)
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}

def gen_status(root, slug):
    png = os.path.join(root, "heroes", slug + ".png")
    logf = os.path.join(PIPELINE, "logs", "gen-%s.log" % slug)
    log = ""
    if os.path.exists(logf):
        try:
            with open(logf, errors="replace") as f:
                log = "".join(f.readlines()[-40:])
        except OSError:
            pass
    p = JOBS.get(slug)
    rc = p.poll() if p else None
    # "done" = the generate PROCESS finished (NOT "png exists" — for a regen the png exists from the start)
    return {"slug": slug, "running": bool(p) and rc is None,
            "returncode": rc, "done": bool(p) and rc is not None,
            "outputExists": os.path.exists(png), "log": log}

# suffixes this tool produces (excluded from the source list, servable for preview)
OUT_SUFFIXES = ("_trim.png", "_256.png", "_128.png")

def is_source(fn):
    fl = fn.lower()
    return fl.endswith(".png") and not any(fl.endswith(s) for s in OUT_SUFFIXES)

def flip_image(root, cat, name, axis):
    """Mirror a tile AT SOURCE using macOS `sips` (no Python image lib, so it works under the launcher's
    /usr/bin/python3). axis 'h' = left-right, 'v' = top-bottom. Also mirrors any existing derived outputs
    (_trim/_256/_128) so every view stays consistent with the flipped source. Alpha + dimensions preserved."""
    if axis not in ("h", "v"):
        return {"ok": False, "error": "axis must be 'h' or 'v'"}
    mode = "horizontal" if axis == "h" else "vertical"
    base_dir = os.path.join(root, cat)
    src = os.path.join(base_dir, name)
    if not os.path.isfile(src):
        return {"ok": False, "error": "source not found: %s/%s" % (cat, name)}
    stem = name[:-4] if name.lower().endswith(".png") else name
    flipped = []
    for fn in [name] + [stem + s for s in OUT_SUFFIXES]:   # source first, then any derived outputs
        p = os.path.join(base_dir, fn)
        if os.path.isfile(p):
            r = subprocess.run(["/usr/bin/sips", "--flip", mode, p],
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if r.returncode != 0:
                return {"ok": False, "error": "sips failed on %s: %s" % (fn, r.stderr.decode()[:200])}
            flipped.append(fn)
    return {"ok": True, "flipped": flipped, "axis": axis}

def boss_slugs(cat):
    """Boss slugs for an enemy area = roster rows whose subject contains 'BOSS'."""
    p = os.path.join(ENEMY_PIPELINE, "rosters", cat + ".tsv")
    out = []
    try:
        for ln in open(p):
            ln = ln.rstrip("\n")
            if not ln or ln.startswith("#"):
                continue
            parts = ln.split("\t", 1)
            if len(parts) == 2 and "BOSS" in parts[1]:
                out.append(parts[0])
    except OSError:
        pass
    return out

def run_photoshop():
    osa = (f'tell application "{PS_APP}"\n    activate\n'
           f'    do javascript (file (POSIX file "{JSX}"))\nend tell')
    try:
        p = subprocess.run(["osascript", "-e", osa], capture_output=True, text=True, timeout=1800)
        return {"ok": p.returncode == 0, "output": p.stdout.strip(), "stderr": p.stderr.strip()}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Photoshop run timed out"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def build_handler(root, meta_path):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass

        def _send(self, code, ctype, body):
            if isinstance(body, str): body = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _safe(self, rel):
            # confine to root
            p = os.path.normpath(os.path.join(root, rel))
            return p if p.startswith(os.path.normpath(root)) else None

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path in ("/", "/index.html"):
                try:
                    with open(os.path.join(ROOT_DIR, "asset_tool.html"), "rb") as f:
                        return self._send(200, "text/html; charset=utf-8", f.read())
                except FileNotFoundError:
                    return self._send(500, "text/plain", "asset_tool.html not found")
            if path == "/api/list":
                cats = []
                for cat in sorted(d for d in os.listdir(root)
                                  if os.path.isdir(os.path.join(root, d))):
                    cdir = os.path.join(root, cat)
                    imgs = sorted(f for f in os.listdir(cdir) if is_source(f))
                    cats.append({"name": cat, "images": imgs,
                                 "bosses": boss_slugs(cat) if cat in ENEMY_AREAS else []})
                return self._send(200, "application/json", json.dumps({"root": root, "categories": cats}))
            if path == "/api/meta":
                if os.path.exists(meta_path):
                    with open(meta_path) as f: return self._send(200, "application/json", f.read())
                return self._send(200, "application/json", json.dumps({"images": {}}))
            if path == "/api/gen-status":
                q = parse_qs(urlparse(self.path).query)
                slug = slugify((q.get("slug", [""])[0]))
                return self._send(200, "application/json", json.dumps(gen_status(root, slug)))
            if path == "/api/export-status":
                return self._send(200, "application/json", json.dumps(export_status()))
            if path in ("/api/regen-queue", "/api/regen-status"):
                return self._send(200, "application/json", json.dumps(regen_queue()))
            if path == "/api/variants-status":
                return self._send(200, "application/json", json.dumps(variants_status()))
            if path.startswith("/variant/"):                     # /variant/<slug>/<i>.png → temp candidate
                parts = path[len("/variant/"):].split("/")
                if len(parts) == 2:
                    slug = slugify(parts[0]); idx = re.sub(r"\.png$", "", parts[1])
                    if slug and idx.isdigit():
                        cand = os.path.join(VARIANTS_DIR, slug, "cand-%d.png" % int(idx))
                        if os.path.isfile(cand):
                            with open(cand, "rb") as f: return self._send(200, "image/png", f.read())
                return self._send(404, "text/plain", "not found")
            if path.startswith("/img/"):
                fp = self._safe(path[len("/img/"):])
                if fp and os.path.isfile(fp):
                    with open(fp, "rb") as f: return self._send(200, "image/png", f.read())
                return self._send(404, "text/plain", "not found")
            return self._send(404, "text/plain", "not found")

        def do_POST(self):
            path = unquote(urlparse(self.path).path)
            if path in ("/api/save", "/api/clip"):
                n = int(self.headers.get("Content-Length", 0))
                try:
                    body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                if path == "/api/save":
                    write_meta(meta_path, body)
                    return self._send(200, "application/json", json.dumps({"ok": True, "path": meta_path}))
                # /api/clip
                meta  = body.get("meta", {"images": {}})
                scope = body.get("scope", "all")
                only  = body.get("only") if scope == "current" else None
                onlyCat = body.get("category") if scope != "current" else None   # "clip all" = one category
                write_meta(meta_path, meta)   # treatments + pockets travel here
                with open(RUNCTL, "w") as f:
                    json.dump({"root": root, "only": only, "onlyCat": onlyCat}, f, indent=2)
                result = run_photoshop()
                try: os.remove(RUNCTL)
                except OSError: pass
                return self._send(200, "application/json", json.dumps(result))
            if path == "/api/generate":
                n = int(self.headers.get("Content-Length", 0))
                try:
                    body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                slug = slugify(body.get("slug", ""))
                subject = (body.get("subject") or "").strip()
                overrides = (body.get("overrides") or "").strip()
                if not slug:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "empty class name"}))
                existing = JOBS.get(slug)
                if existing and existing.poll() is None:
                    return self._send(200, "application/json", json.dumps({"ok": True, "slug": slug, "already": True}))
                try:
                    start_generate(slug, subject, overrides)
                except Exception as e:
                    return self._send(500, "application/json", json.dumps({"ok": False, "slug": slug, "error": str(e)}))
                return self._send(200, "application/json", json.dumps({"ok": True, "slug": slug}))
            if path == "/api/regen":
                n = int(self.headers.get("Content-Length", 0))
                try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                cat = body.get("category")
                if not cat:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "category required"}))
                return self._send(200, "application/json", json.dumps(enqueue_regen(root, cat, body.get("slugs"), (body.get("overrides") or "").strip())))
            if path == "/api/regen-cancel":
                n = int(self.headers.get("Content-Length", 0))
                try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                try: jid = int(body.get("id"))
                except (TypeError, ValueError):
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "numeric id required"}))
                return self._send(200, "application/json", json.dumps(cancel_regen(jid)))
            if path == "/api/delete":
                n = int(self.headers.get("Content-Length", 0))
                try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                cat, name = body.get("cat"), body.get("name")
                if not cat or not name:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "cat + name required"}))
                return self._send(200, "application/json", json.dumps(delete_character(root, meta_path, cat, name)))
            if path == "/api/flip":
                n = int(self.headers.get("Content-Length", 0))
                try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                cat, name, axis = body.get("cat"), body.get("name"), body.get("axis")
                if not cat or not name or axis not in ("h", "v"):
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "cat + name + axis(h|v) required"}))
                return self._send(200, "application/json", json.dumps(flip_image(root, cat, name, axis)))
            if path == "/api/regen-variants":
                n = int(self.headers.get("Content-Length", 0))
                try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                cat = body.get("category"); slug = slugify(body.get("slug", ""))
                if not cat or not slug:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "category + slug required"}))
                return self._send(200, "application/json", json.dumps(
                    start_variants(root, cat, slug, int(body.get("n") or 6), (body.get("overrides") or "").strip())))
            if path == "/api/variants-pick":
                n = int(self.headers.get("Content-Length", 0))
                try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                except Exception as e:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "bad json: %s" % e}))
                cat = body.get("category"); slug = slugify(body.get("slug", ""))
                try: idx = int(body.get("index"))
                except (TypeError, ValueError):
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "numeric index required"}))
                if not cat or not slug:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "category + slug required"}))
                return self._send(200, "application/json", json.dumps(pick_variant(root, cat, slug, idx)))
            if path == "/api/variants-cancel":
                return self._send(200, "application/json", json.dumps(cancel_variants()))
            if path == "/api/export":
                n = int(self.headers.get("Content-Length", 0))
                body = {}
                if n:
                    try: body = json.loads(self.rfile.read(n).decode("utf-8"))
                    except Exception: body = {}
                # save-by-default: persist fill + registration points before exporting
                if isinstance(body.get("meta"), dict):          # save-by-default (fill + reg + portrait + treatments)
                    write_meta(meta_path, body["meta"])
                if body.get("dry"):                              # quick synchronous dry classification
                    return self._send(200, "application/json", json.dumps(run_export(False, True, body.get("category"))))
                start_export(bool(body.get("no_build")), body.get("category"))   # background; ACTIVE CATEGORY only
                return self._send(200, "application/json", json.dumps({"ok": True, "started": True}))
            return self._send(404, "text/plain", "not found")
    return Handler

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="assets")
    ap.add_argument("--port", type=int, default=8790)
    args = ap.parse_args()
    root = args.root if os.path.isabs(args.root) else os.path.join(ROOT_DIR, args.root)
    if not os.path.isdir(root):
        print("root not found:", root); sys.exit(1)
    meta_path = os.path.join(root, "trim_meta.json")
    Handler = build_handler(root, meta_path)
    start_regen_worker()                         # background queue worker (processes regens one at a time)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as httpd:
        print("trim tool: http://localhost:%d   (root: %s)" % (args.port, root))
        print("metadata:", meta_path)
        try: httpd.serve_forever()
        except KeyboardInterrupt: print("\nstopped.")

if __name__ == "__main__":
    main()
