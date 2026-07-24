#!/usr/bin/env bash
# Double-click to stop any running Combat Clean dev server.
PORT="${PORT:-5175}"
PIDS="$(lsof -ti :"$PORT" 2>/dev/null || true)"
if [ -z "$PIDS" ]; then
  echo "No Combat Clean server running on port $PORT."
else
  echo "Stopping Combat Clean server (PID: $PIDS)"
  echo "$PIDS" | xargs kill 2>/dev/null || true
  echo "Stopped."
fi
read -r -p "Press return to close…"
