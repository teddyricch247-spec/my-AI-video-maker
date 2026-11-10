#!/usr/bin/env python3
"""Run every suite in its own process (they use the same module names, e.g. tests/helpers.py, so one pytest run cannot hold them all).

    python scripts/run_tests.py            # everything
    python scripts/run_tests.py --fast     # skip the suites that start Chromium or render video
    python scripts/run_tests.py shared integration

Suites: shared, engine, audio, agent, backend, assets, frontend, integration. Needs pytest (pip install -r requirements-dev.txt).
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SRC = [REPO / "shared" / "src", REPO / "engine" / "src", REPO / "audio" / "src", REPO / "pipeline" / "src", REPO / "agent" / "src", REPO / "backend" / "src", REPO]
SUITES = {
    # name: (cwd, command, needs_browser_or_render)
    "shared": (REPO / "shared", [sys.executable, "-m", "pytest", "-q", "tests"], False),
    "engine": (REPO / "engine", [sys.executable, "-m", "pytest", "-q", "tests"], True),
    "audio": (REPO / "audio", [sys.executable, "-m", "pytest", "-q", "tests"], False),
    "agent": (REPO / "agent", [sys.executable, "-m", "pytest", "-q", "tests"], True),
    "backend": (REPO / "backend", [sys.executable, "-m", "pytest", "-q", "tests"], True),
    "assets": (REPO / "motion-assets", [sys.executable, "tools/check.py", "--quick"], True),
    "frontend": (REPO / "frontend", [sys.executable, "tests/e2e.py"], True),
    "integration": (REPO, [sys.executable, "-m", "pytest", "-q", "integration"], True),
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("suites", nargs="*", choices=list(SUITES))
    ap.add_argument("--fast", action="store_true", help="only suites that need neither Chromium nor ffmpeg rendering (integration and agent run their quick tests)")
    a = ap.parse_args()
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(map(str, SRC))
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    results = {}
    for name in a.suites or SUITES:
        cwd, cmd, heavy = SUITES[name]
        if a.fast and heavy and name not in ("integration", "agent", "backend"):
            continue
        if a.fast and name in ("integration", "agent", "backend"):
            cmd = cmd + ["-m", "not render"]
        t0 = time.time()
        print(f"\n=== {name}: {' '.join(cmd[1:])}  (cwd {cwd.relative_to(REPO) or '.'})", flush=True)
        rc = subprocess.run(cmd, cwd=cwd, env=env).returncode
        results[name] = (rc, time.time() - t0)
    print("\n=== summary")
    for n, (rc, dt) in results.items():
        print(f"{'PASS' if rc == 0 else 'FAIL'}  {n:12s} {dt:6.1f}s")
    return 0 if all(rc == 0 for rc, _ in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
