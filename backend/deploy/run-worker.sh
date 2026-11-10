#!/usr/bin/env bash
# What the Sprite service runs. Loads secrets from ~/.vbeat/env (never from the repo, never from the service definition) and starts the worker.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${VBEAT_ENV_FILE:-$HOME/.vbeat/env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
for v in DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY WORKER_ID; do
  if [ -z "${!v:-}" ]; then echo "worker NOT started: $v is empty. Put it in $ENV_FILE (names: backend/deploy/env.example), then: sprite-env services restart vbeat-worker" >&2; sleep 30; exit 1; fi
done
export PYTHONPATH="$ROOT/backend/src:$ROOT/shared/src:$ROOT/engine/src:$ROOT/audio/src:$ROOT/pipeline/src:$ROOT/agent/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
export VBEAT_WORK_DIR="${VBEAT_WORK_DIR:-/tmp/vbeat-work}"
mkdir -p "$VBEAT_WORK_DIR"
exec "${PY:-python3}" -m vbeat_backend worker
