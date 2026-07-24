#!/usr/bin/env bash
# Double-click this file in Finder to launch Combat Clean (terminal stays open).
# Every launch closes any previous Combat Clean server first, so it re-bakes fresh.
set -e
cd "$(dirname "$0")"
PROJ="$(pwd)"
# Finder-launched shells may not have Homebrew's node/npm on PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-5175}"
URL="http://localhost:$PORT/"

# Close EVERY previous CombatClean dev server (on any port) before starting, so the new
# one re-bakes the config from disk. A reused server serves the config it baked at startup
# — stale after new assets/config are imported. Scoped to THIS project's vite binary so
# MergeCombat and other node apps keep running; then free the port and wait for release.
echo "Closing any previous Combat Clean server…"
pkill -f "$PROJ/node_modules/.bin/vite" 2>/dev/null || true
PIDS="$(lsof -ti :"$PORT" 2>/dev/null || true)"; [ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
for _ in 1 2 3 4 5 6; do lsof -ti :"$PORT" >/dev/null 2>&1 || break; sleep 0.5; done

echo "Combat Clean launcher"
echo "---------------------"
echo "Serving:  $URL"
echo "Quit:     close this terminal window (or Ctrl-C)"
echo

# First run only: install dependencies.
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run, one-time)…"
  npm install
  echo
fi

# `npm run dev` carries --open, so Vite opens the browser once it is listening.
# Pin to CombatClean's own port so it never collides with MergeCombat (5173).
exec npm run dev -- --port "$PORT" --strictPort
