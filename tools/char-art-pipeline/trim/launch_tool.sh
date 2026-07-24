#!/bin/bash
# Background helper for the Mac launcher app. Starts the trim-tool server
# (if not already up), waits until it answers, then opens the browser.
PORT=8790
ROOT=assets
PY=/usr/bin/python3          # present under the minimal Finder PATH; server is stdlib-only
PROJ="/Users/simonhill/combatclean/tools/char-art-pipeline/trim"
URL="http://localhost:$PORT"

cd "$PROJ" || exit 1
up() { /usr/bin/curl -s -o /dev/null --max-time 1 "$URL/api/list"; }

if ! up; then
  nohup "$PY" asset_tool_server.py --root "$ROOT" --port "$PORT" >/tmp/combatclean_trim.log 2>&1 &
fi
for _ in $(seq 1 40); do up && break; sleep 0.5; done
/usr/bin/open "$URL"
