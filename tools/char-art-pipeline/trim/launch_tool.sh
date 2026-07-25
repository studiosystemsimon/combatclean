#!/bin/bash
# Background helper for the Mac launcher app. RESTARTS the trim-tool server on every launch
# (kills any running instance first) so server code changes always take effect, then opens the browser.
PORT=8790
ROOT=assets
PY=/usr/bin/python3          # present under the minimal Finder PATH; server is stdlib-only
PROJ="/Users/simonhill/combatclean/tools/char-art-pipeline/trim"
URL="http://localhost:$PORT"

cd "$PROJ" || exit 1
up() { /usr/bin/curl -s -o /dev/null --max-time 1 "$URL/api/list"; }

# Always restart: kill any existing trim-tool server so the latest server code is loaded every launch.
/usr/bin/pkill -f asset_tool_server.py 2>/dev/null
for _ in $(seq 1 25); do up || break; sleep 0.2; done      # wait for the old server to release the port

nohup "$PY" asset_tool_server.py --root "$ROOT" --port "$PORT" >/tmp/combatclean_trim.log 2>&1 &
for _ in $(seq 1 40); do up && break; sleep 0.5; done
/usr/bin/open "$URL"
