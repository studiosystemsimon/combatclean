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
import argparse, json, os, re, sys, subprocess, http.server, socketserver
from urllib.parse import urlparse, unquote, parse_qs

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))          # .../trim
PIPELINE = os.path.dirname(ROOT_DIR)                            # .../char-art-pipeline
GEN_SH   = os.path.join(PIPELINE, "generate.sh")
JSX     = os.path.join(ROOT_DIR, "trim.jsx")
RUNCTL  = os.path.join(ROOT_DIR, "trim_run.json")
PS_APP  = "Adobe Photoshop 2022"

# in-flight generation jobs: slug -> subprocess.Popen
JOBS = {}

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")

def start_generate(slug, subject):
    """Deploy generate.sh via a LOGIN shell (so claude / fortis-ai-gateway are on PATH),
    detached. generate.sh writes logs/gen-<slug>.log and stages heroes/<slug>.png."""
    env = os.environ.copy()
    env["FORCE"] = "1"
    if subject: env["GEN_SUBJECT"] = subject
    cmd = ["/bin/zsh", "-lc",
           'cd %s && exec bash generate.sh %s' % (_q(PIPELINE), _q(slug))]
    JOBS[slug] = subprocess.Popen(cmd, env=env, cwd=PIPELINE,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  start_new_session=True)

def _q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"

def write_meta(meta_path, data):
    """Persist trim_meta.json, keeping a .bak of the previous contents so a bad/empty
    write can always be recovered."""
    try:
        if os.path.exists(meta_path):
            import shutil; shutil.copyfile(meta_path, meta_path + ".bak")
    except OSError:
        pass
    with open(meta_path, "w") as f:
        json.dump(data, f, indent=2)

def run_export(no_build, dry=False):
    """Run export-to-game.mjs via a LOGIN shell (node/npm/git-lfs on PATH). Parses the
    trailing 'RESULT {json}' summary line."""
    extra = ""
    if dry: extra += " --dry-run"
    elif no_build: extra += " --no-build"
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
def start_export(no_build):
    extra = " --no-build" if no_build else ""
    cmd = ["/bin/zsh", "-lc",
           "cd %s && exec node export-to-game.mjs%s >%s 2>&1" % (_q(PIPELINE), extra, _q(EXPORT_LOG))]
    EXPORT["proc"] = subprocess.Popen(cmd, start_new_session=True)
def export_status():
    p = EXPORT["proc"]
    log = ""
    try:
        with open(EXPORT_LOG, errors="replace") as f: log = f.read()[-4000:]
    except OSError: pass
    result = None
    for line in reversed(log.strip().splitlines()):
        if line.startswith("RESULT "):
            try: result = json.loads(line[len("RESULT "):])
            except Exception: pass
            break
    rc = p.poll() if p else None
    return {"started": bool(p), "running": bool(p) and rc is None,
            "done": bool(p) and rc is not None, "returncode": rc, "result": result, "log": log}

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
    return {"slug": slug, "running": bool(p) and rc is None,
            "returncode": rc, "done": os.path.exists(png), "log": log}

# suffixes this tool produces (excluded from the source list, servable for preview)
OUT_SUFFIXES = ("_trim.png", "_256.png")

def is_source(fn):
    fl = fn.lower()
    return fl.endswith(".png") and not any(fl.endswith(s) for s in OUT_SUFFIXES)

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
                    cats.append({"name": cat, "images": imgs})
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
                write_meta(meta_path, meta)   # treatments + pockets travel here
                with open(RUNCTL, "w") as f:
                    json.dump({"root": root, "only": only}, f, indent=2)
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
                if not slug:
                    return self._send(400, "application/json", json.dumps({"ok": False, "error": "empty class name"}))
                existing = JOBS.get(slug)
                if existing and existing.poll() is None:
                    return self._send(200, "application/json", json.dumps({"ok": True, "slug": slug, "already": True}))
                try:
                    start_generate(slug, subject)
                except Exception as e:
                    return self._send(500, "application/json", json.dumps({"ok": False, "slug": slug, "error": str(e)}))
                return self._send(200, "application/json", json.dumps({"ok": True, "slug": slug}))
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
                    return self._send(200, "application/json", json.dumps(run_export(False, True)))
                start_export(bool(body.get("no_build")))         # real export runs in the BACKGROUND (poll /api/export-status)
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
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as httpd:
        print("trim tool: http://localhost:%d   (root: %s)" % (args.port, root))
        print("metadata:", meta_path)
        try: httpd.serve_forever()
        except KeyboardInterrupt: print("\nstopped.")

if __name__ == "__main__":
    main()
