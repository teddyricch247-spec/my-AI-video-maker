# vbeat agent runner

An LLM (through OpenRouter) authors **one beat** of a narrated explainer video: it writes `scene.js` (a Canvas 2D scene that is a pure
function of time) and `cue.py` (a small sound-design script), reads the deterministic tools' reports, fixes what they flag, and finishes
when the beat renders to a verified `final.mp4`. A human then reviews the result and can send a message back (`continue_beat`).

The runner calls the engine, audio toolkit and pipeline **only as subprocesses** (`python -m vbeat_sprite ...`), reads their one-line JSON
envelopes with `vbeat_shared.envelope.classify`, and imports nothing but `vbeat_shared` and the standard library. Code written by the model
never runs in the runner's process.

This document is written for someone who operates the **hosted** system and has no computer of their own: everything below can be done
from the host's shell/console and its secrets settings.

---

## 1. First time on a host (about 10 minutes)

1. **Set three environment variables as secrets/settings on the host** (never in a file in the repo):

   | name | what | example |
   |---|---|---|
   | `OPENROUTER_API_KEY` | your key from openrouter.ai/keys (the only secret) | `sk-or-v1-...` |
   | `VBEAT_BEAT_MODEL` | the OpenRouter model id to use (must support tool calling) | pick one from `python -m vbeat_agent models --tools-only` |
   | `VBEAT_STATE_DIR` | a folder on a **persistent disk**; holds the kill switch and the daily spend ledger | `/var/data/vbeat` |

2. **Run the bootstrap** (safe to run again at any time; it skips what is already done and never prints or stores the key):

   ```
   bash agent/scripts/bootstrap.sh
   ```

   It checks Python 3.11+, the state folder, the render packages, ffmpeg and Chromium (installing only what is missing), then runs
   `selftest` (renders the example beat through the real tools, **no model, no spend**) and `preflight`. It ends with `READY` or
   `NOT READY`, and every problem is printed as *what / why / what to do*.

3. **Check the key and model with one real call** (costs a few hundredths of a cent):

   ```
   python -m vbeat_agent selftest --ping
   ```

4. **Run one real beat** with the default caps ($0.50 per beat). Use the example transcript to see it work:

   ```
   python -m vbeat_agent run-beat --beat-dir /var/data/beats/first --transcript examples/transcript.json \
       --from-word 0 --to-word 8 --size 1280x720 --title "Big number"
   ```

   Progress lines go to stderr; the last line on stdout is one JSON envelope. Exit code `0` = finished and waiting for review,
   `1` = stopped and needs a person, `2` = failed or bad usage. If it ends anywhere but `finished`, the message says what happened, why,
   and what to do. `python -m vbeat_agent diagnose --beat-dir <dir>` explains any beat in plain language at any time.

## 2. Money safety

Defaults (change with the environment variables below, or flags `--max-usd`, `--max-usd-per-day`, `--max-usd-total`):

| cap | default | applies to |
|---|---|---|
| per beat | **$0.50** | one `run_beat` / `continue_beat` call (each `continue` gets a fresh cap; totals accumulate in `state.json`) |
| per run | **$5.00** | one `run_beats` batch, shared by all its beats |
| per day | **$10.00** | everything on this machine, all processes, enforced by a ledger in `VBEAT_STATE_DIR` |

- The cap is a promise: **before** each model call the runner reserves its expected cost against all three budgets and refuses the call if
  it would cross one. Overshoot is limited to calls already in flight.
- If OpenRouter does not report a cost for a call, a conservative estimate ($0.05) is charged instead; such calls are counted
  (`unknown_cost_calls`) and shown by `diagnose`.
- `python -m vbeat_agent ledger` shows today's spend; every charge is also one line in `VBEAT_STATE_DIR/ledger.jsonl`.
- The day starts and ends at midnight UTC (set `VBEAT_LEDGER_TZ`, e.g. `Africa/Johannesburg`, to change it).
- **If `VBEAT_STATE_DIR` is wiped** (for example a host that resets its home folder on each deploy) the daily total starts again at
  zero. `preflight` warns when the folder looks temporary.
- Steps (40), minutes (15), repeated tool errors (6) and a stuck-loop detector also stop a run; none of them cost money to hit.

## 3. The kill switch

```
python -m vbeat_agent kill            # stop everything now, block anything new
python -m vbeat_agent kill --off      # allow runs again
```

or set the environment variable `VBEAT_KILL=1` and restart. Running beats stop within about a second (also in the middle of a model call or
a render), their work is saved, and they report `cancelled` with reason `kill_switch`. A new run refuses to start while it is on. Nothing is
lost: `continue` resumes from the saved conversation.

## 4. Secrets

- The key is read **only** from the `OPENROUTER_API_KEY` environment variable. There is no `--api-key` option (it would show up in process
  lists and shell history) and the runner never prompts for it.
- It is held in memory, sent in one HTTP header, and **never** written to disk or logged: every persisted line (events, transcript,
  conversation, state, ledger) and every log record is redacted, error messages from OpenRouter are redacted, and `Settings.__repr__`
  hides it. Tool subprocesses (where model-written code runs) receive an environment without secret-looking variables.
- `python -m vbeat_agent selftest` and `preflight` report whether a key is set, never its value. The test suite sets a recognisable key,
  runs a whole beat through the real client against a local fake server, and searches every file and output for it.

## 5. Commands

All commands print human text to stderr and **one JSON envelope** to stdout.

| command | purpose |
|---|---|
| `preflight [--model M] [--no-network] [--no-browser]` | can this system run beats? key, credits, model, kill switch, daily headroom, disk, Chromium, ffmpeg, prompt inputs. No spend. |
| `selftest [--ping] [--model M] [--keep]` | renders the example beat through the real tools and verifies the video. No spend; `--ping` adds one tiny paid tool-calling test. |
| `diagnose --beat-dir D` | what happened to this beat, in plain language (state, last check, retries, tool faults, cost) |
| `run-beat ...` | author one beat (see `--help`) |
| `continue --beat-dir D --message "..."` | resume a beat with a reviewer's message, an answer, or after a kill/crash |
| `run-beats --plan plan.json [--concurrency N]` | many beats in parallel from a JSON list of requests |
| `revert --beat-dir D --scene N --cue N` | make an older version current (the final video becomes stale) |
| `models [--tools-only] [--filter text]` | the OpenRouter catalogue (no key needed) |
| `prompt [--out file]` | build and show the system prompt (assembled from the repo's own docs) |
| `replay --beat-dir D` | the run as chat messages (the web API's `Message` shape) |
| `kill [--off]`, `ledger` | the kill switch and today's spend |

There is no fake or offline model on the command line. To check a machine without spending anything, use `selftest`.

## 6. Environment variables

| variable | default | meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | – | the key (secret) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API base |
| `VBEAT_BEAT_MODEL` | – | model id for beats |
| `VBEAT_STATE_DIR` | `~/.vbeat-agent` | kill switch + ledger (persistent disk!) |
| `VBEAT_MAX_USD_PER_BEAT` / `_PER_RUN` / `_PER_DAY` | 0.50 / 5.00 / 10.00 | caps |
| `VBEAT_LEDGER_TZ` | `UTC` | where the day starts |
| `VBEAT_KILL` | – | `1` = kill switch on |
| `VBEAT_BEAT_CONCURRENCY` | 4 | beats in flight in `run_beats` |
| `VBEAT_MAX_HEAVY` | cores / 2 (min 1) | simultaneous Chromium/ffmpeg tools across all beats (see section 8) |
| `VBEAT_REQUEST_TIMEOUT` | 180 | seconds per HTTP attempt |
| `VBEAT_MAX_TOKENS`, `VBEAT_TEMPERATURE` | 12000 / 0.3 | sampling (output limit per model call) |
| `VBEAT_PROVIDER` | – | OpenRouter provider preferences as JSON (default `{"require_parameters": true}` when tools are sent) |
| `VBEAT_MODELS_FALLBACK` | – | comma-separated fallback model ids |
| `VBEAT_USAGE_FLAG` | on | `0` stops sending `usage: {include: true}` |
| `VBEAT_IMAGES` | `auto` | `auto` (if the model can see images) / `on` / `off` |
| `VBEAT_WRITE_CHECK_LEVEL` | `fast` | the automatic check after `write_scene`: `fast` or `full` |
| `VBEAT_CHILD_MEM_MB` | 0 (off) | address-space limit for tool subprocesses (Chromium needs a very large one; leave off) |
| `VBEAT_CACHE_DIR`, `VBEAT_ASSETS_DIR`, `VBEAT_REPO` | repo defaults | locations |
| `VBEAT_LOG_LEVEL` | `INFO` | log level (stderr, JSON lines for model calls: no prompts, no key) |

## 7. When something goes wrong

| you see | it means | do this |
|---|---|---|
| `NOT READY` from bootstrap | a prerequisite is missing | read the FAIL line: it says why and what to do; run bootstrap again |
| `no_api_key` | the process has no `OPENROUTER_API_KEY` | set it as a secret on the host and restart the process |
| `llm_auth` "rejected the API key" (401) | wrong, revoked or truncated key | create a new key at openrouter.ai/keys |
| `llm_auth` "out of credits" (402) | no balance | add credits at openrouter.ai/credits, then `continue` |
| `llm_auth` 403 | key/model/region restriction | try another model or check the key's settings |
| `model_not_supported` | the model has no tool calling | pick one from `models --tools-only` |
| `llm_unavailable` | OpenRouter or the provider is down/rate limiting (already retried with backoff) | wait, `continue`; or set `VBEAT_MODELS_FALLBACK` |
| `cap:daily_usd` | today's cap is used up | wait for the new day or raise `VBEAT_MAX_USD_PER_DAY` |
| `cap:max_usd` | this beat reached its cap | look at the result; `continue` with a clearer instruction and `--max-usd` if it is close |
| `cap:max_steps` / `cap:max_minutes` / `stuck` / `cap:max_tool_errors_in_a_row` | the agent was not converging | `diagnose`, then `continue` with a specific hint or `revert` |
| `tool_fault:<tool>` | the machine failed (Chromium/ffmpeg crashed or timed out), not the model | `selftest`; restart the host; give it more memory |
| `kill_switch` | the kill switch is on | `kill --off` (and unset `VBEAT_KILL`) |
| a beat says `running` but nothing runs | the process was killed | `continue --beat-dir D` resumes it; nothing is lost |

## 8. Parallelism (measured, on a 2-CPU test machine)

`run_beats` runs `concurrency` beats at once but bounds the number of heavy subprocesses (Chromium renders, ffmpeg) across **all** of them
(`VBEAT_MAX_HEAVY`), so many beats queue for rendering instead of thrashing. `make agent-bench` runs it with a scripted model (no
spend) and real rendering. Measured here (2 CPUs, simulated 1.5 s model latency per turn): 3 beats took **195 s one at a time and
109 s with 3 in flight and a gate of 2 (x1.8)**; the gate was never exceeded. Model latency overlaps perfectly; rendering does not shrink, so the
gain is bounded by CPU cores. The default gate is `cores / 2`, which is conservative: on a machine with N free cores,
`VBEAT_MAX_HEAVY=N` is usually right (each Chromium render is mostly single-threaded). Not measured: behaviour on the actual hosted
machine's memory limit; give each parallel beat about 1 GB.

## 9. Python interface (for the backend)

```python
from vbeat_agent import (BeatRequest, BeatResult, run_beat, continue_beat, revert_beat, run_beats,
                         FileEventSink, CallbackSink, events_to_messages, preflight, selftest, diagnose)

res = await run_beat(BeatRequest(beat_dir=..., transcript=..., from_word=0, to_word=8, width=1280, height=720, idx=3,
                                 title="...", direction="...", model="<openrouter id>"), sink=CallbackSink(push_to_ui), cancel=event)
res = await continue_beat(beat_dir, "Make the number red.", sink)          # also resumes after a kill
revert_beat(beat_dir, scene_n=1)                                           # raises BeatBusy while a run holds the beat
results = await run_beats(requests, concurrency=4)                         # results in request order; one bad beat never ends the batch
preflight(); selftest(); diagnose(beat_dir)                                # sync, JSON-able, safe inside a running event loop
```

Nothing raises for things that happen *during* a run: the `BeatResult` carries `status` (`waiting_user | needs_attention | failed |
cancelled`), `status_reason`, and `explanation` = `{code, what, why, fix}` in plain language. The only exceptions are `BeatBusy` (another process holds
the beat), `ValueError` (no model), `KeyError` (revert to a version that does not exist, naming the ones that do). `cancel` is an
`asyncio.Event`; the file `<beat>/agent/CANCEL`, the kill switch and SIGTERM (in the CLI) do the same. Events: [docs/EVENTS.md](docs/EVENTS.md).
`width`/`height` are the render size; scenes always draw on the 1280x720 logical canvas.

## 10. Files in a beat directory

```
<beat>/transcript.json spec.json scene.js cue.py strip.jpg report.json markers.json video.mp4 final.mp4 ...   the contract files (CONTRACTS section 11)
<beat>/versions/scene_NNN.js (+ .check.json .meta.json .strip.jpg)  cue_NNN.py (+ .report.json .wav .preview.jpg)  preview/
<beat>/agent/request.json state.json conversation.jsonl transcript.md llm_calls.jsonl events.jsonl system_prompt.md  (CANCEL, run.lock while relevant)
```

`scene.js`/`cue.py` are always plain copies of the current version, so the dev server and preview just work. Numbering comes from the files on
disk. Every run that stops without finishing leaves the **best** scene and cue (fewest errors; a full check beats a fast one) in place.

## 11. Tests

`make test` runs everything (the agent's suite included); `make test-fast` skips tests that start Chromium (`-m "not render"`).
`make agent-example` = no-spend selftest, `make agent-preflight`, `make agent-bench`. The tests use a scripted model (`tests/fake_llm.py`)
and a local fake OpenRouter server (`tests/fake_server.py`); both live only under `tests/`. **Nothing in the tests calls the real
OpenRouter**, so the live behaviour of OpenRouter and of any particular model is verified only by running `selftest --ping` and a real beat.
See [docs/DECISIONS.md](docs/DECISIONS.md) for what is unverified and [docs/NEEDS.md](docs/NEEDS.md) for requests to the frozen pieces.
