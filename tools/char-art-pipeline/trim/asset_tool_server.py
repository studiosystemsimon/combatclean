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
import argparse, json, os, sys, subprocess, http.server, socketserver
from urllib.parse import urlparse, unquote

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
JSX     = os.path.join(ROOT_DIR, "trim.jsx")
RUNCTL  = os.path.join(ROOT_DIR, "trim_run.json")
PS_APP  = "Adobe Photoshop 2022"

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
                    with open(meta_path, "w") as f: json.dump(body, f, indent=2)
                    return self._send(200, "application/json", json.dumps({"ok": True, "path": meta_path}))
                # /api/clip
                meta  = body.get("meta", {"images": {}})
                scope = body.get("scope", "all")
                only  = body.get("only") if scope == "current" else None
                contract = meta.get("contract_px", 12)
                with open(meta_path, "w") as f: json.dump(meta, f, indent=2)
                with open(RUNCTL, "w") as f:
                    json.dump({"root": root, "only": only, "contract_px": contract}, f, indent=2)
                result = run_photoshop()
                try: os.remove(RUNCTL)
                except OSError: pass
                return self._send(200, "application/json", json.dumps(result))
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
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), Handler) as httpd:
        print("trim tool: http://localhost:%d   (root: %s)" % (args.port, root))
        print("metadata:", meta_path)
        try: httpd.serve_forever()
        except KeyboardInterrupt: print("\nstopped.")

if __name__ == "__main__":
    main()
