#!/usr/bin/env bash
# Get a host ready to run vbeat agent beats, and prove it. Safe to run any number of times: every step first checks whether its
# work is already done and only acts when something is missing. Run from anywhere:
#
#     bash agent/scripts/bootstrap.sh              # fix what is missing, then selftest + preflight
#     bash agent/scripts/bootstrap.sh --check-only # change nothing, only report
#     bash agent/scripts/bootstrap.sh --ping       # also make one tiny PAID model call (a few hundredths of a cent)
#
# Options: --no-install (never install anything), --skip-selftest, --model <openrouter id>.
#
# SECRETS: the OpenRouter key is read ONLY from the OPENROUTER_API_KEY environment variable of this process. This script never
# asks for it, never writes it anywhere (no .env, no config, no log) and never prints it; it only reports whether it is set.
# Set it as a secret in your hosting dashboard, not in a file.
#
# Exit code: 0 = ready to run beats, 1 = something still has to be fixed (the output says what, why and what to do).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PY="${PY:-python3}"
CHECK_ONLY=0; NO_INSTALL=0; SKIP_SELFTEST=0; PING=0; MODEL="${VBEAT_BEAT_MODEL:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1; NO_INSTALL=1 ;;
    --no-install) NO_INSTALL=1 ;;
    --skip-selftest) SKIP_SELFTEST=1 ;;
    --ping) PING=1 ;;
    --model) shift; MODEL="${1:-}" ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

export PYTHONPATH="$ROOT/shared/src:$ROOT/engine/src:$ROOT/audio/src:$ROOT/pipeline/src:$ROOT/agent/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE=1

PROBLEMS=0
say()  { printf '%s\n' "$*" >&2; }
ok()   { say "[ ok ] $*"; }
note() { say "[note] $*"; }
bad()  { PROBLEMS=$((PROBLEMS + 1)); say "[FAIL] $1"; [ -n "${2:-}" ] && say "       Why: $2"; [ -n "${3:-}" ] && say "       What to do: $3"; return 0; }
can_install() { [ "$NO_INSTALL" -eq 0 ]; }
sudo_cmd() { if [ "$(id -u)" -eq 0 ]; then "$@"; elif command -v sudo >/dev/null 2>&1; then sudo -n "$@"; else return 127; fi; }

# ---- 1. Python 3.11+ ---------------------------------------------------------------------------------------------------------
if ! command -v "$PY" >/dev/null 2>&1; then
  bad "Python was not found ('$PY')." "The runner is written in Python 3.11 or newer." "Install Python 3.11+ (or set PY=/path/to/python3.11) and run this again."
  exit 1
fi
if "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
  ok "Python $("$PY" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
else
  bad "Python is too old ($("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])'))." "The runner needs 3.11 or newer." "Install Python 3.11+ (or set PY=/path/to/python3.11) and run this again."
  exit 1
fi

# ---- 2. the state folder (kill switch + daily spend ledger) --------------------------------------------------------------------
STATE="${VBEAT_STATE_DIR:-$HOME/.vbeat-agent}"
if [ "$CHECK_ONLY" -eq 0 ]; then mkdir -p "$STATE" 2>/dev/null && chmod 700 "$STATE" 2>/dev/null; fi
if [ -d "$STATE" ] && [ -w "$STATE" ]; then
  ok "State folder $STATE is writable"
elif [ ! -e "$STATE" ] && [ "$CHECK_ONLY" -eq 1 ] && [ -w "$(dirname "$STATE")" ]; then
  ok "State folder $STATE does not exist yet and can be created"
else
  bad "State folder $STATE is missing or not writable." "The daily spend cap and the kill switch live there." "Set VBEAT_STATE_DIR to a writable folder on a persistent disk."
fi
case "$STATE" in /tmp/*|/var/tmp/*|/dev/shm/*) note "The state folder is in a temporary location: the \$/day cap resets if the host wipes it. Use a persistent disk via VBEAT_STATE_DIR." ;; esac
[ -z "${VBEAT_STATE_DIR:-}" ] && note "VBEAT_STATE_DIR is not set; using $STATE. If your host wipes the home folder on deploy, the daily cap starts from zero each time."

# ---- 3. Python packages for rendering --------------------------------------------------------------------------------------------
pydeps_ok() { "$PY" -c 'import playwright, numpy, scipy, PIL' >/dev/null 2>&1; }
if pydeps_ok; then
  ok "Python render packages are installed"
elif can_install; then
  say "[....] Installing the Python render packages (first run only)..."
  if "$PY" -m pip install -q -r "$ROOT/requirements-dev.txt" >/dev/null 2>"${TMPDIR:-/tmp}/vbeat-pip.err" || "$PY" -m pip install -q --break-system-packages -r "$ROOT/requirements-dev.txt" >/dev/null 2>>"${TMPDIR:-/tmp}/vbeat-pip.err"; then
    pydeps_ok && ok "Python render packages installed" || bad "The packages installed but cannot be imported." "The Python used here differs from the one pip installed into." "Run: $PY -m pip install -r requirements-dev.txt and check which python is on PATH."
  else
    bad "Could not install the Python render packages." "$(tail -n 1 "${TMPDIR:-/tmp}/vbeat-pip.err" 2>/dev/null | cut -c1-200)" "Check the host's outbound network access to pypi.org, then run this again (or: $PY -m pip install -r requirements-dev.txt)."
  fi
else
  bad "Python render packages are missing (playwright, numpy, scipy, pillow)." "Rendering cannot work without them." "Run this script without --check-only/--no-install, or: $PY -m pip install -r requirements-dev.txt"
fi

# ---- 4. ffmpeg / ffprobe ---------------------------------------------------------------------------------------------------------
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "ffmpeg and ffprobe are installed"
elif can_install && command -v apt-get >/dev/null 2>&1; then
  say "[....] Installing ffmpeg (first run only)..."
  { sudo_cmd apt-get update -qq && sudo_cmd apt-get install -y -qq ffmpeg fonts-dejavu-core; } >/dev/null 2>&1
  if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then ok "ffmpeg installed"; else
    bad "ffmpeg could not be installed." "apt-get failed or this user may not install system packages." "Install ffmpeg on the host (apt install ffmpeg) or add it to the host's build image, then run this again."; fi
else
  bad "ffmpeg or ffprobe is missing." "Videos cannot be assembled or checked without them." "Install ffmpeg (apt install ffmpeg), or add it to the host's build image."
fi

# ---- 5. Chromium -----------------------------------------------------------------------------------------------------------------
chromium_ok() { "$PY" - >/dev/null 2>&1 <<'PYEOF'
from playwright.sync_api import sync_playwright
p = sync_playwright().start(); b = p.chromium.launch(); b.close(); p.stop()
PYEOF
}
if ! pydeps_ok; then
  note "Skipping the Chromium check until the Python packages are in place."
elif chromium_ok; then
  ok "Chromium starts"
elif can_install; then
  say "[....] Installing Chromium (first run only, a few hundred MB)..."
  "$PY" -m playwright install chromium >/dev/null 2>&1
  chromium_ok || { [ "$(id -u)" -eq 0 ] && "$PY" -m playwright install --with-deps chromium >/dev/null 2>&1; }
  chromium_ok && ok "Chromium installed and starts" || bad "Chromium still cannot start." "The browser download failed or the host lacks system libraries it needs." "Run: $PY -m playwright install --with-deps chromium  (as root), or use a host image that includes Chromium's libraries."
else
  bad "Chromium cannot start." "It is not installed or the host lacks a library it needs." "Run this script without --check-only/--no-install."
fi

# ---- 6. the key: presence only ---------------------------------------------------------------------------------------------------
if [ -n "${OPENROUTER_API_KEY:-}" ]; then ok "OPENROUTER_API_KEY is set in the environment (value not shown)"; else
  note "OPENROUTER_API_KEY is not set. Add it as a secret named OPENROUTER_API_KEY on the hosting system (never in a file); the checks below that need it will say so."; fi

# ---- 7. prove it: selftest (no spend) then preflight ------------------------------------------------------------------------------
if [ "$PROBLEMS" -gt 0 ]; then
  say ""; say "NOT READY: $PROBLEMS problem(s) above. Fix them and run this script again; finished steps are skipped."
  exit 1
fi
RC=0
if [ "$SKIP_SELFTEST" -eq 0 ]; then
  say ""; say "== selftest: rendering the example beat through the real tools (about a minute, no model, no spend)"
  ST_ARGS=(selftest)
  if [ "$PING" -eq 1 ]; then ST_ARGS+=(--ping); [ -n "$MODEL" ] && ST_ARGS+=(--model "$MODEL"); fi
  "$PY" -m vbeat_agent "${ST_ARGS[@]}" >/dev/null || RC=1
fi
say ""; say "== preflight"
PF_ARGS=(preflight); [ -n "$MODEL" ] && PF_ARGS+=(--model "$MODEL")
"$PY" -m vbeat_agent "${PF_ARGS[@]}" >/dev/null || RC=1
say ""
if [ "$RC" -eq 0 ]; then
  say "READY. Daily cap, kill switch and spend ledger live in $STATE. Stop everything at any time with: $PY -m vbeat_agent kill"
else
  say "NOT READY: see the FAIL lines above (each says why and what to do). Re-run this script after fixing them."
fi
exit "$RC"
