#!/usr/bin/env bash
# Start the backend (http://localhost:8000) and the frontend (http://localhost:5173).
# Ctrl+C stops both. Override the ports with BACKEND_PORT and FRONTEND_PORT if they are taken.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

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
  echo "==> Frontend: http://localhost:$FRONTEND_PORT"
  (cd "$ROOT/frontend" && BACKEND_URL="http://localhost:$BACKEND_PORT" exec npm run dev -- --port "$FRONTEND_PORT" --strictPort) &
  pids+=($!)
fi

wait
