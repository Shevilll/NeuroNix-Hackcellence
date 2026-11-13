#!/usr/bin/env bash
# Start the backend (http://localhost:8000) and the frontend (http://localhost:5173).
# Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"

if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "error: backend is not set up. Run ./scripts/setup.sh first." >&2
  exit 1
fi

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Backend:  http://localhost:$BACKEND_PORT"
(cd "$ROOT/backend" && exec .venv/bin/uvicorn app.main:app --port "$BACKEND_PORT") &
pids+=($!)

if [ -f "$ROOT/frontend/package.json" ]; then
  echo "==> Frontend: http://localhost:5173"
  (cd "$ROOT/frontend" && exec npm run dev -- --port 5173) &
  pids+=($!)
fi

wait
