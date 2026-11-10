# vbeat: everything runs from a source checkout; nothing needs installing (PYTHONPATH is set here).
# `make setup` is only for the Python dependencies of the render machine.
SHELL := /bin/bash
export PYTHONPATH := $(CURDIR)/shared/src:$(CURDIR)/engine/src:$(CURDIR)/audio/src:$(CURDIR)/pipeline/src:$(CURDIR)/agent/src:$(CURDIR)/backend/src:$(CURDIR)
export PYTHONDONTWRITEBYTECODE := 1
PY ?= python3
OUT ?= out/big_number

.PHONY: setup test test-fast check-assets index example devserver agent-example agent-preflight agent-bench help
help:
	@grep -E '^[a-z-]+:.*##' Makefile | sed 's/:.*##/\t/'
setup: ## install render-machine Python deps and Chromium
	$(PY) -m pip install -r requirements-dev.txt && $(PY) -m playwright install chromium
test: ## every suite, each in its own process
	$(PY) scripts/run_tests.py
test-fast: ## only the suites that need no browser or video rendering
	$(PY) scripts/run_tests.py --fast
check-assets: ## manifest/index vs the modules on disk, id collisions (no browser)
	$(PY) scripts/check_assets.py
index: ## rebuild motion-assets/assets/manifest.json and index.json (run after dropping in a new asset zip), then check
	$(PY) motion-assets/tools/build_index.py && $(PY) scripts/check_assets.py
example: ## the documented pipeline on the example beat -> $(OUT)/final.mp4
	$(PY) -m vbeat_pipeline render-beat --transcript examples/transcript.json --from-word 0 --to-word 8 \
	  --scene examples/beats/big_number/scene.js --cue examples/beats/big_number/cue.py --out $(OUT) --size 1280x720 --title "Big number"
devserver: ## mock API + the real beat in $(OUT) played by the real engine, http://127.0.0.1:8000 (password: demo)
	$(PY) devserver/server.py --beat $(OUT)
agent-example: ## the agent's no-spend self test: renders the example beat through the real tools, verifies the video, calls no model
	$(PY) -m vbeat_agent selftest
agent-preflight: ## is this system ready to run beats? (needs OPENROUTER_API_KEY in the environment for the key and credit checks)
	$(PY) -m vbeat_agent preflight
agent-bench: ## parallel beats with a scripted test model: heavy-tool gating and wall time (no spend)
	$(PY) agent/tests/bench_parallel.py
