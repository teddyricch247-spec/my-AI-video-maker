#!/usr/bin/env bash
# Set up a render host on Ubuntu 24.04. Run from the repo root: bash scripts/setup_sprite.sh
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ffmpeg fonts-dejavu-core python3-venv

python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e '.[sprite,test]'
playwright install --with-deps chromium

echo "Done. Try: source .venv/bin/activate && pytest -q"
