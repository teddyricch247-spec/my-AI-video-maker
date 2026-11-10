#!/usr/bin/env bash
# Update this worker to the latest code and restart it. Run ON the worker (via the Sprites exec tool or a console).
#     bash backend/deploy/update.sh [branch]
# Running beats are told to save their state (SIGTERM) and are picked up by another worker after the stale timeout (90 s).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="${PY:-python3}"
cd "$ROOT"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
git fetch --quiet origin "$BRANCH"
git merge --ff-only "origin/$BRANCH"
echo "now at $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
"$PY" -m pip install -q "psycopg[binary,pool]>=3.1" -r requirements-dev.txt 2>/dev/null || "$PY" -m pip install -q --break-system-packages "psycopg[binary,pool]>=3.1" -r requirements-dev.txt
bash backend/deploy/bootstrap.sh worker --check-only >/dev/null 2>&1 || { echo "bootstrap check failed; run: bash backend/deploy/bootstrap.sh worker" >&2; exit 1; }
if command -v sprite-env >/dev/null 2>&1; then sprite-env services restart vbeat-worker; else echo "restart the worker service yourself (sprite-env not found)"; fi
