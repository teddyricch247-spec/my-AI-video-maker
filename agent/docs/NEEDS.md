# Requests to the frozen pieces

The runner works against the pieces as they are. Nothing here blocks it; each item would make it safer, cheaper or simpler. None was
applied (the brief forbids changing `shared/ engine/ audio/ pipeline/ motion-assets/assets/` or the web API).

1. **Engine: include C4 (text bounds) in the `fast` check, or add a `--level medium`.** C4 is the most common finding a model produces and only `full` sees it, so the model needs an extra, slower round trip (the full check is slower than the fast one) to learn about it. The runner mitigates with a prompt instruction and by letting `finish` fail with the finding (tests: `test_golden.py`, `test_finish_fails_at_check_then_succeeds`). Until then `VBEAT_WRITE_CHECK_LEVEL=full` is the workaround.
2. **Pipeline: a structured failure in `pipeline.json`.** The runner maps a failed `finish` to the failing stage by reading `failed_stage` and the report text. A documented, stable shape (`{"ok": false, "failed_stage": "...", "findings": [...]}`) in CONTRACTS section 11 would let the runner stop parsing text.
3. **Pipeline: document (or tolerate) that the scene/cue given may already be the beat's own `scene.js`/`cue.py`.** The pipeline copies the given scene/cue into the beat directory as `scene.js`/`cue.py` and fails on a same-file copy, so the runner always passes the `versions/` files (DECISIONS D4).
4. **Audio: ship `audio/sfx/SYNTH_API.md` (or guarantee `python -m vbeat_audio docs` output is stable).** The prompt builder reads the file when present and otherwise runs the `docs` command; both work, the file is faster and cacheable.
5. **CONTRACTS section 1: add the `agent` row** (`agent/ | agent runner | render machine | vbeat_shared`). The brief allowed only a new section, so the runner's row is in new section 13; `integration/test_boundaries.py` already enforces it.
6. **Web API: a place for cost and the explanation.** `Message` has no field for run cost or the plain-language `explanation`. The backend can read both from `BeatResult` / `status` events; if the UI should show them, `status` events would need a field in `API_CONTRACT.md`.
7. **Frontend/web API: a "kill switch" and "spend today" control.** The runner exposes `kill_switch_engage/release/engaged` and `SpendLedger.today()` for the backend to surface; nothing in the frozen API has a place for them.
