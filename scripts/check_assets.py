#!/usr/bin/env python3
"""Verify the asset library from its files alone (no browser): manifest and index in sync with the modules on disk,
no id collisions, known namespaces, one core. Exit 0 clean, 1 on any error. Run it after dropping in a new asset zip.

    python scripts/check_assets.py [--assets motion-assets/assets]
"""
import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "shared" / "src"))
from vbeat_shared.assets import check_tree  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assets", type=Path, default=REPO / "motion-assets" / "assets")
    a = ap.parse_args()
    probs = check_tree(a.assets)
    for p in probs:
        print(p)
    errors = [p for p in probs if p.level == "error"]
    print(f"{len(errors)} error(s), {len(probs) - len(errors)} warning(s) in {a.assets}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
