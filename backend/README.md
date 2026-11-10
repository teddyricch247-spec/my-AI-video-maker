# vbeat backend — workers (Part 1)

Stateless, interchangeable workers: each claims jobs from Supabase (`beat.run`, `export.build`), runs beats through `vbeat_agent`, and mirrors everything back. A worker's disk is scratch. **Read `docs/WORKER_CONTRACT.md` first** (what is read, written, and when; statuses; how the planner enqueues work; Sprite findings; unknowns).

## Live test from a Sprite (cheap model first)

```bash
# once per worker (idempotent; ends PASS or FAIL, and each FAIL says what to do)
bash backend/deploy/bootstrap.sh worker
# fill in ~/.vbeat/env (names: backend/deploy/env.example), run bootstrap again until PASS

export $(grep -v '^#' ~/.vbeat/env | xargs)          # for the CLI commands below
export PYTHONPATH=$PWD/backend/src:$PWD/shared/src:$PWD/engine/src:$PWD/audio/src:$PWD/pipeline/src:$PWD/agent/src

python -m vbeat_backend seed-example --beats 3 --model <cheap openrouter model id>   # project "__test__<time>", 3 beats, 3 jobs
python -m vbeat_backend worker &                      # or the Sprite service (backend/deploy/worker.service)
python -m vbeat_backend job-status                    # queue, running jobs per worker, last errors, spend today
python -m vbeat_backend diagnose-beat <beat_id>       # paste this to your AI when something fails
python -m vbeat_backend cleanup-test-data             # removes every __test__ project, its rows and Storage objects
```

Stop everything at once: `update settings set value='true' where key='kill_switch'` (workers stop within ~2 s and the beats go back to `queued`).

## Tests

`make test-fast` runs `backend/tests` without Chromium (units + the fast end-to-end paths); `make test` includes the render tests (golden beat, feedback on another worker, a worker dying mid-beat, six beats on two workers). They use an in-memory database/Storage double (`tests/fake_db.py`) and the runner's scripted model; no network, no spend.
