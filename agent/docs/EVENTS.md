# Agent events

Every run emits events to an `EventSink` (`emit(event: dict) -> None`; never raises into the run: a sink that fails is ignored). The same
events are appended to `<beat>/agent/events.jsonl` (one JSON object per line, redacted) and rendered into `agent/transcript.md`.

Sinks: `FileEventSink(path)`, `CallbackSink(fn)`, `ListSink()` (tests), `MultiSink(*sinks)`. In `run_beats` a single sink receives all beats'
events (each stamped with `beat_idx`), or pass a function `request -> sink` for one sink per beat.

## Common fields (every event)

| field | meaning |
|---|---|
| `type` | one of the types below |
| `ts` | ISO-8601 UTC timestamp |
| `beat_idx` | `BeatRequest.idx` |
| `step` | the model turn this event belongs to (0 outside a turn). Resets to 1 on each `run_beat` / `continue_beat`; `state.json.steps` is the cumulative count |

## Types

| `type` | extra fields | when |
|---|---|---|
| `run_started` | `model`, `caps`, `starting` (true for `run_beat`, false for `continue_beat`), `scene_n`, `sfx_n` | a run begins |
| `user_message` | `text` | `continue_beat` was called with a reviewer message (or an answer to `ask_user`) |
| `llm_call` | `model`, `attempts`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `cost_usd` (null if unknown), `cost_source` (`api` / `catalogue` / `unknown`), `finish_reason` | after each model call (bookkeeping) |
| `cost` | `run_cost_usd`, `total_cost_usd`, `steps` | after each model call and at the end |
| `assistant_message` | `text` (may be empty when the model only called tools) | the model's turn |
| `tool_call` | `name`, `call_id`, `args_summary` | before a tool runs (sources are never inlined: a summary such as `source 3.1 KB`) |
| `tool_result` | `name`, `call_id`, `ok`, `kind` (`model_fault` / `tool_fault` / null), `summary`, `text` (first 2000 chars of what the model was told), `image_paths` (beat-relative), `wall_ms` | after a tool |
| `scene_version` | `n`, `checks` `{error, warn}`, `level`, `bytes`, `path`, `note`, `rechecked` (when a later check updated an existing version) | a scene version was saved or its check updated |
| `sfx_version` | `n`, `checks` `{error, warn}`, `path` | a cue version was saved |
| `note` | `text` | the runner did something worth showing (best version restored, revert) |
| `status` | `status` (`waiting_user` / `needs_attention` / `failed` / `cancelled`), `reason`, `explanation` (`{code, what, why, fix}` or null) | the run ended |
| `run_finished` | `result` (the full `BeatResult.to_dict()`) | last event of every run |

`BeatResult.explanation` and `status.explanation` use the same plain-language object. `status_reason` values: `finished`, `ask_user`,
`give_up`, `checks_failed:<codes>`, `cap:max_steps`, `cap:max_minutes`, `cap:max_usd`, `cap:total_max_usd`, `cap:daily_usd`,
`cap:max_tool_errors_in_a_row`, `cap:context`, `no_tool_call`, `stuck`, `llm_auth`, `llm_bad_request`, `llm_unavailable`, `llm_error`,
`model_not_supported`, `tool_fault:<tool>`, `kill_switch`, `cancel_file`, `sigterm`, `sigint`, `cancelled`, `cancel:batch_auth_error`, `busy`,
`no_api_key`, `internal_error`, `bootstrap`.

## `events_to_messages(events, url_for=None, start_seq=1)`

Maps events to the frozen web API's `Message` objects (`frontend/docs/API_CONTRACT.md`):
`{seq, role: "user" | "assistant" | "event", text, steps: [{name, summary, ok, image_urls}], created_at, queued}`.

- `user_message` → `user`.
- `assistant_message` plus that step's `tool_call` / `tool_result` events → one `assistant` message whose `steps` are the tool calls (`image_urls` from `image_paths` through `url_for`, which the backend supplies; default is the path itself). A step without prose has `text: ""`.
- `scene_version` → `event` "Scene v2 saved: 1 errors, 3 warnings"; `sfx_version` likewise; `status`, `note`, `run_started`, `run_finished` → `event` one-liners.
- `llm_call` and `cost` produce nothing.
- Unknown event types are ignored; a `tool_result` without its `tool_call` still produces a step.
- `seq` runs from `start_seq` (the backend continues numbering across runs).

## The mirror (for backends with a database)

`run_beat(..., mirror=m)` / `continue_beat(..., mirror=m)` call `m.message(msg)` for every line appended to `agent/conversation.jsonl` (the redacted message as it is on disk, with its `_meta`) and `m.state(state_dict)` after state writes (at most once a second, plus one final call at the end of the run; underscore keys removed). Events are unchanged: versions and statuses still reach a backend through `scene_version`, `sfx_version`, `status` and `run_finished`, and the version files can be read with `hydrate.read_version_bundle`. `hydrate.rebuild_beat_dir` is the inverse: it recreates a beat directory from the stored conversation, state and versions (see DECISIONS.md, A4).

## Files that carry the same information

- `agent/conversation.jsonl`: the exact messages exchanged with the model, one JSON per line, fsynced per message. Tool messages carry `_meta` (summary, name, ok) used only for compaction; it is never sent to the API. Preview images are stored as `{"type": "image_file", "path": ...}` parts and become data URLs at send time; the most recent preview only.
- `agent/llm_calls.jsonl`: one line per model call: `step, model, attempts, latency_ms, prompt_tokens, completion_tokens, cost_usd, cost_source, budget_cost_usd, finish_reason, context_tokens_est, elided, run_cost_usd`. No prompts, no key.
- `agent/state.json`: `status, status_reason, steps, cost_usd, wall_s, scene_n, sfx_n, full_ok_n, final_video, final_stale, last_report, question, summary, caps, runs, pid, restored_best, ...`.
- `<state_dir>/ledger.jsonl`: one line per charge: `ts, date, beat, model, usd, estimated, total_today`.
