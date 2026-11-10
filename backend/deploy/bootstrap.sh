#!/usr/bin/env bash
# Get this machine ready to be a vbeat WORKER, and prove it. Idempotent: safe to run any number of times.
#     bash backend/deploy/bootstrap.sh worker              # install what is missing, then prove it
#     bash backend/deploy/bootstrap.sh worker --check-only # change nothing, only report
# Wraps agent/scripts/bootstrap.sh (Python render packages, ffmpeg, Chromium, selftest of the real tools, preflight), then adds what the worker needs:
# psycopg, a 0600 secrets file skeleton at ~/.vbeat/env (NEVER overwritten, never printed), a working scratch folder, and a database check.
# Secrets are read only from the environment / ~/.vbeat/env. Ends with PASS or FAIL.
set -uo pipefail
ROLE="${1:-}"; shift || true
[ "$ROLE" = "worker" ] || { echo "usage: bash backend/deploy/bootstrap.sh worker [--check-only]   (the planner role comes in part 2)" >&2; exit 2; }
CHECK_ONLY=0; for a in "$@"; do [ "$a" = "--check-only" ] && CHECK_ONLY=1; done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="${PY:-python3}"
ENV_FILE="${VBEAT_ENV_FILE:-$HOME/.vbeat/env}"
FAILS=0
say() { printf '%s\n' "$*" >&2; }
ok()  { say "[ ok ] $*"; }
bad() { FAILS=$((FAILS + 1)); say "[FAIL] $1"; [ -n "${2:-}" ] && say "       What to do: $2"; return 0; }

# 1. secrets skeleton (names only, empty values, mode 600) -------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ] && [ "$CHECK_ONLY" -eq 0 ]; then
  mkdir -p "$(dirname "$ENV_FILE")" && chmod 700 "$(dirname "$ENV_FILE")"
  grep -E '^[A-Z_]+=' "$ROOT/backend/deploy/env.example" | sed -E 's/[[:space:]]+#.*$//' > "$ENV_FILE"; chmod 600 "$ENV_FILE"
  say "[note] created $ENV_FILE with empty values. Fill it in (DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY, TICK_SECRET, WORKER_ID), then run this again."
fi
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; ok "secrets file $ENV_FILE ($(stat -c %a "$ENV_FILE") permissions; values not shown)"; }

# 2. render stack: the runner's own idempotent bootstrap (python packages, ffmpeg, chromium, selftest, preflight) -----------------
ARGS=(); [ "$CHECK_ONLY" -eq 1 ] && ARGS+=(--check-only)
if bash "$ROOT/agent/scripts/bootstrap.sh" "${ARGS[@]}"; then ok "render stack ready (agent bootstrap)"; else bad "the render stack is not ready (see the FAIL lines above)" "fix them, run this script again"; fi

# 3. psycopg -------------------------------------------------------------------------------------------------------------------------
if "$PY" -c 'import psycopg, psycopg_pool' 2>/dev/null; then ok "psycopg + pool installed"
elif [ "$CHECK_ONLY" -eq 0 ]; then
  { "$PY" -m pip install -q "psycopg[binary,pool]>=3.1" || "$PY" -m pip install -q --break-system-packages "psycopg[binary,pool]>=3.1"; } >/dev/null 2>&1
  "$PY" -c 'import psycopg, psycopg_pool' 2>/dev/null && ok "psycopg + pool installed" || bad "could not install psycopg" "run: $PY -m pip install 'psycopg[binary,pool]'"
else bad "psycopg is missing" "run this script without --check-only"; fi

# 4. required settings are present (presence only) ------------------------------------------------------------------------------------
for v in DATABASE_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENROUTER_API_KEY TICK_SECRET WORKER_ID; do
  if [ -n "${!v:-}" ]; then ok "$v is set (value not shown)"; else bad "$v is empty" "set it in $ENV_FILE"; fi
done
case "${WORKER_ID:-}" in worker-[1-9]) ;; "") ;; *) say "[note] WORKER_ID=${WORKER_ID} is not worker-1..worker-9; fine, but it must be stable and unique" ;; esac

# 5. the database and Storage are reachable with these credentials ---------------------------------------------------------------------
export PYTHONPATH="$ROOT/backend/src:$ROOT/shared/src:$ROOT/engine/src:$ROOT/audio/src:$ROOT/pipeline/src:$ROOT/agent/src${PYTHONPATH:+:$PYTHONPATH}" PYTHONDONTWRITEBYTECODE=1
if [ -n "${DATABASE_URL:-}" ] && [ -n "${SUPABASE_URL:-}" ]; then
  OUT=$("$PY" -m vbeat_backend job-status 2>&1 >/dev/null); RC=$?
  if [ "$RC" -eq 0 ]; then ok "database reachable (job-status works)"
  else bad "the database check failed: $(echo "$OUT" | tail -n 3 | tr '\n' ' ' | cut -c1-240)" "DATABASE_URL must be the SESSION POOLER string (not db.<ref>.supabase.co, which is IPv6-only); check the password and that the migrations in backend/migrations were applied"; fi
fi
mkdir -p "${VBEAT_WORK_DIR:-/tmp/vbeat-work}" 2>/dev/null && ok "scratch folder ${VBEAT_WORK_DIR:-/tmp/vbeat-work} is writable" || bad "scratch folder is not writable" "set VBEAT_WORK_DIR"

echo
if [ "$FAILS" -eq 0 ]; then echo "PASS: this machine can run as ${WORKER_ID:-a worker}. Start it with the Sprite service (backend/deploy/worker.service) or: bash backend/deploy/run-worker.sh"; exit 0
else echo "FAIL: $FAILS problem(s) above. Each says what to do. Re-run this script after fixing them."; exit 1; fi
