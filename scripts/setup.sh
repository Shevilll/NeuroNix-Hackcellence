#!/usr/bin/env bash
# One-time setup: backend virtualenv + dependencies, frontend dependencies.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pick the first Python that is 3.12 or newer.
PYTHON=""
for candidate in python3.14 python3.13 python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "error: Python 3.12 or newer is required" >&2
  exit 1
fi

echo "==> Backend: creating virtualenv with $PYTHON"
"$PYTHON" -m venv "$ROOT/backend/.venv"
"$ROOT/backend/.venv/bin/pip" install --quiet --upgrade pip
"$ROOT/backend/.venv/bin/pip" install --quiet -e "$ROOT/backend[dev]"

if [ -f "$ROOT/frontend/package.json" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "error: Node.js 20+ and npm are required for the frontend" >&2
    exit 1
  fi
  echo "==> Frontend: installing dependencies"
  (cd "$ROOT/frontend" && if [ -f package-lock.json ]; then npm ci; else npm install; fi)
fi

echo "==> Setup complete. Start the app with: ./scripts/start.sh"
