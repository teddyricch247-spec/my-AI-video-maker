# Agent runner: decisions, deviations, and what is not verified

Numbers are referenced from code comments and `README.md`. "Brief" = the task description this runner was built from.

## Change of requirements (applied after the first design)

The operator has no computer and tests only on the live hosted system with a real OpenRouter key. Consequences, all implemented:

- **No `--fake` anywhere user-facing.** The scripted model (`tests/fake_llm.py`) and the local fake OpenRouter (`tests/fake_server.py`) live only under `agent/tests/` and are injected through `run_beat(..., llm=...)` / a local `OPENROUTER_BASE_URL`. The CLI rejects model ids like `fake`, and `--fake` is a usage error (tested). The no-spend way to check a machine is `selftest`.
- **`preflight()`, `selftest()`, `diagnose()`** (`health.py`), CLI commands of the same names, JSON-able, redacted, each finding with *what / why / fix*.
- **Kill switch** (`killswitch.py`): `<state_dir>/KILL` file or `VBEAT_KILL=1`; checked before every model call and tool, and polled every second while a model request or a subprocess runs.
- **Daily spend ledger** (`budget.py`) with defaults $0.50 / beat, $5 / run, $10 / day; reservation before each call, settlement after.
- **Plain-language errors** (`errors.explain`) on `BeatResult.explanation`, on `status` events, in `transcript.md`, in `diagnose`, on stderr.
- **Secrets never logged or written** (`redact.py`), tested by searching the whole tree.
- **`agent/scripts/bootstrap.sh`**, idempotent.

## Decisions

**D1. Subprocess-only tool access.** The brief allows importing `vbeat_sprite.api` etc. I use `python -m ...` subprocesses for all of them: it is the only way to kill a hung Chromium cleanly (process group), to keep model-written code out of the runner process, to apply per-tool timeouts, and to make the kill switch effective mid-tool. The cost is ~0.3 s of Python start-up per call.

**D2. Standard-library HTTP client, not httpx.** `httpx` was not installed in the build environment and package installs were blocked, so the OpenRouter client uses `urllib` in a worker thread. Consequences: a cancelled model call abandons its thread until the socket times out (the run is not blocked; the thread ends within `request_timeout`); no HTTP/2 or connection pooling (irrelevant at this call rate). If you prefer httpx, only `openrouter._http` changes.

**D3. The automatic check after `write_scene` is `fast`; `finish` runs the full check through the pipeline.** The engine's fast check does not evaluate C4 (text bounds), C5, C7, C8. The system prompt says so and tells the model to run `check_scene level=full` after layout changes. A model that never runs it still cannot finish with a C4 error, because `finish` runs the pipeline's own full check and the failure is returned to the model (`golden` and `fail_then_fix` tests exercise this with a real C4). `VBEAT_WRITE_CHECK_LEVEL=full` runs the full check after every write (slower, safer).

**D4. `spec.json` does not need a scene file;** the runner creates a placeholder `scene.js` only so the engine tools have something to open, and `finish` takes the sources from `versions/` (the pipeline copies them to `scene.js`/`cue.py`; copying a file onto itself was a trap, so `scene.js` is never a symlink and the pipeline is pointed at the versioned files).

**D5. Ingest first.** `transcript.json` and `spec.json` are produced once per beat directory before the first model call, so the model sees real word ids and the true duration. The `direction`, `mode`, `bible`, `neighbours`, `params` live in `agent/request.json` (the source of truth for `continue`).

**D6. Caps.** Defaults: 40 steps, 15 min, **$0.50**, 6 tool errors in a row, 60k-token context budget. The money cap is checked *before* a call using the run's average cost per call (`cost + average > cap` stops), so a cap is not crossed by more than a call already in flight. `continue_beat` starts from fresh caps; `steps`, `cost_usd`, `wall_s` in `state.json` are cumulative (`BeatResult.run_*` are this call only).

**D7. Stuck handling.** Identical call ×3, identical findings ×3, or A-B-A-B alternation → one warning to the model, then three more strikes → `needs_attention` / `stuck`. Plain-text answers are nudged twice, then `no_tool_call`. A tool fault (the machine, not the model) is retried once, then the run is `failed` with `tool_fault:<tool>`.

**D8. Context compaction is deterministic and local** (no summarising model call): the first user message, the latest `write_*` arguments, the latest report of each kind and the last 6 messages are kept verbatim; older tool results, older write arguments and older assistant prose are replaced by one-line summaries recorded at the time. Images are kept for the **latest** preview only, as data URLs built at send time from files on disk (the conversation file stores `image_file` parts, never base64). More than 1.5× the budget after compaction → `cap:context`.

**D9. Best-version rule.** A run that ends without success leaves the best scene and cue in place (fewest errors; a full check beats a fast one; ties go to the later version). `scene.js` is always a copy of the current version. Identical re-writes of a faulted source reuse its version number instead of creating a duplicate (idempotent retries).

**D10. Resume.** The conversation is appended and fsynced per message. After a kill the last assistant message may have tool calls without results; they are answered with a synthetic "interrupted" result, a torn last line is dropped, and `continue_beat` resumes. A beat is locked by an `flock` on `agent/run.lock` (`BeatBusy` for a second runner).

**D11. Daily ledger semantics.** One `ledger-state.json` (guarded by `flock`) holds today's spent total and in-flight reservations; `ledger.jsonl` is an append-only audit. Reservations from dead processes or older than 20 minutes expire so a crash cannot lock money forever. A corrupt state file is replaced rather than blocking all work. The day is UTC unless `VBEAT_LEDGER_TZ` is set. If the state folder is lost the day's total restarts at zero (`preflight` warns about temporary-looking folders).

**D12. Costs.** `usage.cost` from OpenRouter when present; else tokens × catalogue price; else unknown → charged `unknown_call_cost_usd` ($0.05) and counted.

**D13. Tool results given to the model are JSON** `{"ok", "text" | "error", "kind": "model_fault" | "tool_fault", ...}` capped at 4096 bytes of text; unknown asset ids return the five closest ids; `rt.at('wXXXX')` word ids are checked against the beat's words before anything renders.

**D14. Parallelism.** One global gate (`toolrun.HEAVY`) bounds heavy subprocesses (Chromium, ffmpeg); default `cores/2`. Read-only tool calls within one model turn run concurrently, writes sequentially. `run_beats` isolates failures; a rejected key (the same for every beat) cancels the rest of the batch immediately.

**D15. Allowed edits outside `agent/`**, and only these: `integration/test_boundaries.py` (`ALLOWED`, `PKG_DIR`, `agent` on the render-machine list; the lazy optional `PIL` import is why), `scripts/run_tests.py`, `Makefile`, one line in the root `README.md`, and a new section 13 in `docs/CONTRACTS.md`. The layering *table* in CONTRACTS section 1 was not edited (the brief forbids changing existing text); section 13 carries the row.

## Additions for stateless workers (A1-A5)

The runner still keeps its working state in a beat directory on disk and still knows nothing about databases. A backend whose workers are interchangeable (their disks are scratch) needs five small, optional hooks. Every one defaults to the previous behaviour, so all earlier tests are unchanged.

**A1. Kill-switch provider** (`killswitch.register_provider(fn | None)`). `engaged()` now asks, in order: the environment, the `KILL` file, the provider. `fn() -> reason | None` must be synchronous and fast, because `CancelSignal.is_set()` calls `engaged()` in hot paths (every LLM call, every tool call, every second while a tool runs); the backend keeps a cached value fresh from a background task. A provider that raises is treated as "not engaged" (a broken provider must not stop every run). `has_provider()` tells the preflight a database owns the switch.

**A2. Injectable daily ledger** (`ledger=` on `run_beat`, `continue_beat`, `run_beats`). `None` = the machine's disk `SpendLedger` (as before); `False` = no daily ledger; anything else with `today() -> {"remaining": ...}` and `bind(beat, model) -> Budget`. The start-of-run guard and `CompositeBudget` use it. The reason recorded when it refuses is the object's `denial_reason` (disk ledger: `cap:daily_usd`); `CompositeBudget` still reports the reason of the budget that refused, so reasons stay `cap:daily_usd`, `cap:run_usd`, `cap:max_usd` (per-beat caps come from `Caps.max_usd`, and `cap:total_max_usd` for the in-process shared budget).

**A3. Mirror** (`mirror=` on `run_beat` / `continue_beat`; protocol in `mirror.py`). `message(m)` is called after each message is appended to `conversation.jsonl` (the redacted line that is on disk, `_meta` kept), `state(st)` after each state write, at most once a second, plus exactly one final call per run (`SafeMirror.final`). Underscore keys of the state (`_run_base`) are not passed. The disk is written first; a mirror that raises is logged and ignored. Messages written while preparing a run (the system prompt, the first user message, repaired tool calls, the reviewer's message) are mirrored too, because the hook sits on `ConversationStore.append`.

**A4. Hydrate and dump** (`hydrate.py`, pure functions). `rebuild_beat_dir(...)` writes exactly the files the runner expects from stored data; `read_version_bundle(beat_dir, kind, n)` reads one version back out as `{n, source, report, meta, strip_path, wav_path, spectrogram_path}`. Choices: (1) strips, wavs, spectrograms and derived files (`final.mp4`, `markers.json`, `report.json`) are not rebuilt, and the state's claims about them (`final_video`, `markers_n`, `full_ok_n`) are cleared, so the runner regenerates them; (2) if the stored state names a version that was never stored (state is mirrored at most once a second, so it can lag a crash by a second) the highest stored version is current and the state is corrected; (3) `pid` is cleared. Covered by a round-trip test: run, dump, rebuild into an empty directory, `continue_beat`, assert the conversation continues, version numbers follow on and nothing is redone.

**A5.** `preflight` no longer warns that the state folder looks temporary when a kill-switch provider is registered (the switch and, in a backend, the ledger live elsewhere). `explain` is exported from the package root next to `diagnose`.

## Not verified (no live access was available)

These were built from documentation and tested only against a local fake server:

1. **Anything about the live OpenRouter**: exact error bodies, `Retry-After` behaviour, whether `usage: {include: true}` is needed or accepted, and whether `provider: {require_parameters: true}` ever excludes every endpoint of a model (then a 404 `ModelNotSupported` results: set `VBEAT_PROVIDER='{"allow_fallbacks": true}'`, which replaces the default and drops `require_parameters`).
2. **`reasoning_details` pass-back**: some reasoning models require their reasoning to be returned unchanged on the next turn. The client stores and echoes `reasoning_details` when present. Untested live.
3. **Any particular model's behaviour**: tool-calling quality, whether it follows the system prompt (about 37k characters, ~9k tokens), whether it looks at previews, cost per beat (the $0.50 cap may be too low or too high for the chosen model: `selftest --ping` and the first real beat tell).
4. **Memory on the hosted machine**: Chromium needs ~1 GB per parallel beat; `max_heavy` bounds renders, not the number of idle beats.
5. **Prompt caching** is not configured; the stable prefix is ordered for it but no `cache_control` is sent.
6. **`finish` duration** at 1920x1080 and longer beats: timeouts are `180 s + 40 s per second of beat`, calibrated only on the 4 s example at 1280x720, which finished well inside them on the 2-CPU test machine (a whole scripted beat, ten steps, took about a minute).
7. **Windows/macOS**: Linux only (`flock`, process groups, `/proc`).
