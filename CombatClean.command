#!/usr/bin/env bash
# Double-click this file in Finder to launch Combat Clean (terminal stays open).
set -e
cd "$(dirname "$0")"
# Finder-launched shells may not have Homebrew's node/npm on PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-5175}"
URL="http://localhost:$PORT/"

if lsof -ti :"$PORT" >/dev/null 2>&1; then
  echo "Combat Clean already running — opening browser…"
  open "$URL"
  echo
  read -r -p "Press return to close this terminal window…"
  exit 0
fi

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
