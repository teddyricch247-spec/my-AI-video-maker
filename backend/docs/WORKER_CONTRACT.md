# Worker contract (Part 1 → Part 2)

This is the single reference the planner (Part 2) builds on. The worker is **stateless**: its disk is scratch, every beat is resumable by any worker, all state is in Supabase (project `qoxfwvifhsrjfbscydgn`, "Quan video generator", region eu-west-1). Part 2 will not change the worker unless this document says it can (§12).

Code: `backend/src/vbeat_backend/` (package `vbeat_backend`), migrations `backend/migrations/`, deploy `backend/deploy/`. Run: `python -m vbeat_backend worker`.

## 1. Jobs the worker runs

Only these two kinds are claimed: `claim_job(WORKER_ID, ['beat.run','export.build'], '90 seconds')`. `director.turn` is the planner's.

| kind | payload (jsonb) | notes |
|---|---|---|
| `beat.run` | `{"beat_id": uuid, "session_id": uuid, "resume"?: bool, "model"?: text}` | `session_id` is **required** (the unique index `jobs_one_active_per_session` is on `payload->>'session_id'`). `model` overrides `settings.models.beat` (tests). `resume` is informational: the worker decides new-vs-continue by whether the session already has raw messages. |
| `export.build` | `{"export_id": uuid}` | one active per export (`jobs_one_active_per_export`). |

`jobs.project_id` must be set (paused-project filter in `claim_job`). Per-kind global limits are read by `claim_job` from `settings`: `beat_concurrency` (27), `concurrency.director.turn` (2), `concurrency.export.build` (2); defaults apply when a key is absent/null. Per-worker limit is `WORKER_SLOTS` (3), enforced by the worker.

## 2. What the worker reads

| from | what |
|---|---|
| `jobs` | its claimed row (`payload`), and its own row on heartbeat failure (`locked_by`, `status`, `cancel_requested`) |
| `beats` ⋈ `projects` | `idx, title, mode, direction, word_from, word_to, session_id` ⋈ `fps, width, height, sfx_enabled, bible, paused, name` (`beat_text`, `f0`, `f1`, `priority` are not used: the runner derives frames itself) |
| neighbours | `beats.title, beats.summary` of the nearest lower/higher `idx` in the same project → `neighbours.prev/next` |
| `transcripts.data` | the **raw** transcript JSON exactly as the runner's ingest accepts it (`examples/transcript.json` format: `{"words":[...]}` or a list). Stored raw; the worker writes it to scratch and the runner's ingest normalises it. Planner must store it unmodified. |
| `media` | `filename, storage_path` → downloaded from bucket `uploads` into scratch; the runner's media key is **`media.filename`** (assumption, see §13). |
| `sessions` | `state->'runner'` (the runner's state dict), `status, model, steps, cost_usd` |
| `messages` | `visible=false` rows ordered by `seq` (`content` = the full raw message) → rebuilds `conversation.jsonl`; queued user rows (`queued and role='user' and visible`) |
| `scene_versions`, `sfx_versions` | `n, code, checks` (+`created_by,created_at`) → rebuilds `versions/` |
| `settings` | refreshed every 2 s by a background thread: `kill_switch`, `caps` (`run_usd, daily_usd, max_steps, max_minutes, beat_usd`), `models.beat`, `sfx_peak_dbfs`, and the concurrency keys (SQL side) |
| `cost_events` / `sessions.cost_usd` | via `spend_today(tz)`, `project_spend(project)` before every model call |
| `exports`, `beats` | for `export.build`: `exports.beat_ids`, `beats.final_path` |

Request mapping: `from_word/to_word = beats.word_from/word_to` (numeric strings become ints), caps = `settings.caps` with `max_usd = caps.beat_usd`, `model = payload.model or settings.models.beat` (empty → job `failed`, "choose a beat model in Settings").

## 3. What the worker writes, and when

**Raw conversation** → `messages`, `visible=false`, through `append_message` (atomic `seq`): `role` = message role (`system|user|assistant|tool`), `content` = the **entire** message JSON (incl. `tool_calls`, `tool_call_id`, `_meta`; `\u0000` stripped), `tool_call_id`, `usage` = `_meta.usage` if present. Images are `image_file` parts (paths), never base64. **Idempotent**: before each insert the writer compares the session's raw row count with the message's index and skips if present, so a retried write never duplicates. Written after the runner's own disk write, in order, by a per-job writer thread (never blocks the beat loop).

**UI rows** → `messages`, `visible=true`, `queued=false`, through `append_message`: `role` `assistant|event`, `ui_text`, `ui_steps` (`[{name, summary, ok, image_urls}]`), `content = {"text","steps"}`. Built from the runner's events with `events_to_messages`. An assistant row is **inserted when its step starts** and **updated in place** as tool results arrive. `user_message` events are **not** written: the planner owns user rows (it inserts them when the human sends them). `image_urls` entries are storage URIs `previews:<object path>` (the API turns them into signed URLs).

**Versions** → `scene_versions(beat_id, n, code, checks, strip_path, created_by='agent')`, `sfx_versions(beat_id, n, code, checks, wav_path, spectrogram_path)`, upserted on `(beat_id, n)`; `checks` = the runner's full report (cue reports include `metrics`). Synced after `scene_version`/`sfx_version` events, after `preview/finish/check_scene/write_*/revert_*` tool results, and at the end; only changed versions are rewritten. A later full check updates an older version's `checks`. `created_by` of an existing row is never overwritten.

**Beat / session**
- `beats.scene_n, sfx_n` and `sessions.steps/model/state` — at most once a second while running (coalesced) and once at the end.
- `sessions.state` (jsonb, merged by top-level key): `runner` (state dict), `request` (the request without machine paths), at the end `result` (BeatResult dict, `final_video` = `renders:<path>`), `explanation` (`{code, what, why, fix}`), on failure `error {code,message}` and, for crashes, `debug` (the runner's `diagnose` text + traceback, redacted).
- Status transitions: §4.

**Storage** (all private, upserted):
- bucket `previews`: `<project_id>/<beat_id>/scene_<NNN>.strip.jpg`, `cue_<NNN>.wav`, `cue_<NNN>.preview.jpg` (spectrogram), `media/<relative path>` (images that tool results show).
- bucket `renders`: `<project_id>/<beat_id>/final.mp4` (on `waiting_user`; sets `beats.final_path`, `beats.final_bytes`), `<project_id>/exports/<export_id>/export.zip` and `manifest.json`.
- Free-plan caps: 50 MB per file (bucket limits: renders 50 MB, previews 10 MB), 1 GB total. A final.mp4 over 50 MB is **not uploaded**: beat → `needs_attention`, reason `final_too_large: ...`.

**Costs** → `cost_events(project_id, session_id, model, kind='llm', tokens_in, tokens_out, tokens_cached(null), usd)` one row per model call, written synchronously on settle (the trigger rolls into `sessions.cost_usd`). Failed/cancelled calls cost 0 and write nothing. If the DB is down at settle the cost is kept in memory and retried; `result.unrecorded_cost_usd` reports anything still unwritten.

**Workers** → `workers(id, role='worker', url, slots, running, heavy, version, last_seen, info)` every 10 s (`info`: host, uptime, claimed_total, claiming, blocked_reason, preflight status, last errors).

**Exports** → `exports.status` (`running` → `done|failed`), `progress_done/progress_total`, `files` (`[{name, beat_id, idx, title, bytes, sha256}]`), `zip_path`, `manifest_path` (both in `renders`), `expires_at` (+7 days; **nothing deletes the objects yet**, Part 2's reconciler must), `error` on failure.

## 4. Status transitions

**Job** (`jobs.status`): `queued → running` (claim; `attempts+1`) → `done | failed | canceled`. Stale (heartbeat older than 90 s) → `queued` again, or `failed` when `attempts >= max_attempts`, or `canceled` when `cancel_requested`. After the migration `max_attempts=3` means three runs.

| worker outcome | `finish_job` | `jobs.error` |
|---|---|---|
| beat `waiting_user` or `needs_attention` | `done` | null (reason is on the beat) |
| runner `failed` | `failed` | `<code>: <what> Why: <why> Fix: <fix>` |
| exception / `JobFailure` | `failed` | `<code>: <message>` (codes: `no_model, no_transcript, beat_not_found, bad_payload, no_session, media_download_failed, transcript_rejected, internal_error`) |
| kill switch | `canceled` | `stopped by kill switch` |
| `cancel_requested` | `canceled` | `cancel requested` |
| lock lost | *nothing* (another owner) | — |
| SIGTERM | *nothing* (stale sweep requeues after ≤90 s) | — |

**Beat** (`beats.status` / `status_reason`):
- start of a run: `running`, reason `null`.
- runner `waiting_user` → `waiting_user`, reason `finished` or `ask_user` (the question is in `sessions.state.result.question`).
- runner `needs_attention` → `needs_attention`, reason one of `cap:max_steps, cap:max_minutes, cap:max_usd, cap:daily_usd, cap:run_usd, cap:context, cap:total_max_usd, cap:max_tool_errors_in_a_row, no_tool_call, stuck, give_up, checks_failed` (runner codes) or `final_too_large: …`.
- runner `failed` → `failed`, reason = runner code (`llm_auth, llm_bad_request, llm_unavailable, llm_error, model_not_supported, no_api_key, bootstrap:ingest, bootstrap:spec, tool_fault:<tool>, internal_error`), or a `JobFailure` code from the table above.
- kill switch → `queued`, reason **`stopped by kill switch`**.
- `cancel_requested`, lock lost, SIGTERM → **the worker does not touch the beat** (it stays `running`); the planner decides.
- `approved`, `skipped` are never set by the worker.

**Session** (`sessions.status`): `running` at start; `waiting_user` | `flagged` (for needs_attention) | `failed` | `queued` (kill switch) at the end.

## 5. How the planner must enqueue things

All inserts go into `jobs` with `project_id` set, `kind='beat.run'`, payload `{beat_id, session_id}`. At most **one active (`queued`/`running`) job per session** (unique index); inserting a second fails: treat that as "already queued".

- **First run** (plan approved): create the beat's session, set `beats.session_id`, insert the job. Beat/session status `queued`.
- **Feedback**: insert a `messages` row `role='user', visible=true, queued=true, ui_text=<text>, content={"text":<text>}` (via `append_message(..., p_queued=true)`), then insert a `beat.run` job **if none is active**. The worker reads queued rows when a job starts, passes the text to the runner as the reviewer's message, and clears `queued` only **after the reviewer message is stored** (so a crash between never loses feedback; the retry re-reads it). **A queued row that arrives while a job is running is not seen by that job**: when a job finishes, the planner/reconciler must enqueue a follow-up if queued user rows remain.
- **Retry / resume** (a `failed` or `needs_attention` beat; or `queued` after the kill switch): insert a `beat.run` job; set beat/session `queued`. The conversation, versions and cost so far are kept; the run continues. Note the per-beat cap `caps.beat_usd` is **cumulative over the beat's life** (`sessions.cost_usd`): a beat that already spent it will stop immediately with `cap:max_usd` until the operator raises the cap.
- **Skip**: planner-only: set `beats.status='skipped'`; if a job is active set `cancel_requested` (see below). Nothing for the worker.
- **Approve**: planner-only: `beats.status='approved'` (only from `waiting_user`). Nothing for the worker.
- **Revert** (restore an older scene/cue version): planner-only in Part 2 today; the worker has no revert job. To revert, the planner enqueues feedback text (e.g. "revert to scene v2") or Part 2 adds a `beat.revert` kind; `vbeat_agent.revert_beat` exists in the runner but the worker does not call it. **Unknown/decision for Part 2.**
- **Export**: insert `exports` row (`status='queued', beat_ids=[...]`), then `export.build` job `{export_id}`. All listed beats must have `final_path` (the worker fails the export with the list of unrendered beats otherwise).

## 6. Kill switch, pause, cancel

- **Kill switch** (`settings.kill_switch = true`): `claim_job` returns nothing; workers stop claiming; running beats see it within ≤2 s (cached value polled by the runner) and stop **before the next model call or tool**, saving state. The beat goes to `queued` (`stopped by kill switch`), the job `canceled`. **Planner duty when the switch is turned off**: re-enqueue a `beat.run` job for every beat in `queued` with `status_reason='stopped by kill switch'` that has no active job (the worker does not do this).
- **Project paused** (`projects.paused = true`): `claim_job` skips its queued jobs. Running jobs are not affected unless the planner also calls `cancel_project_jobs` (sets `cancel_requested` on the project's jobs): then the next heartbeat (≤15 s) returns false, the worker cancels the run, flushes what it has, and finishes the job `canceled` (`cancel requested`). The beat is left `running`: the planner must set it to `queued` (or whatever it wants).
- **Lost lock** (job requeued/taken while this worker was slow): the worker stops, drops unwritten data, writes nothing more, does not finish the job.

## 7. HTTP (worker status app, stdlib, port `PORT`, default 8080)

- `GET /healthz` — open. `{ok, worker, running, slots, heavy, claiming, blocked_reason, kill_switch, version}`; no secrets.
- `POST /wake` — header `X-Tick-Secret` (constant-time compare against `TICK_SECRET`; if `TICK_SECRET` is empty everything is refused). Makes the loop look for work **now**. Returns the same JSON as `/healthz`. Workers also poll every 2 s, so `/wake` is an optimisation, **except** if a worker's Sprite or service is stopped: a request to a service created with `http_port` starts it (see §10).
- `GET /preflight` — same header. Runs the runner's `preflight` (key, state dir, ffmpeg, Chromium, ...; one tiny OpenRouter reachability check) and returns the report; also re-evaluates whether the worker may claim.
- Everything else 404. Logs never contain headers.

## 8. Process behaviour

Start: `requeue_own_orphans(WORKER_ID)` (own running jobs from a previous life: → `queued`, or `failed` if attempts exhausted, or `canceled`) — **never call `requeue_orphans`**; preflight (a blocking failure ⇒ no claiming, reason in `/healthz.blocked_reason` and the `workers` row); settings refresher; kill-switch provider registered with the runner; `workers` upsert every 10 s; HTTP app.
Loop: while `running < WORKER_SLOTS`, not killed, not blocked: `claim_job`; each job is an asyncio task; idle poll 2 s; immediate re-poll after a claim, a finish or `/wake`. Heavy Chromium/ffmpeg work is bounded process-wide by the runner's gate (`VBEAT_MAX_HEAVY`, default 2).
Per job: background heartbeat every 15 s (`job_heartbeat`), independent of tools; writers wait while no heartbeat succeeded for 75 s. Scratch dir `VBEAT_WORK_DIR/job-<id>` is always deleted.
SIGTERM/SIGINT: stop claiming, tell running beats to cancel (they save state), wait ≤30 s, release nothing; the stale sweep requeues the jobs after ≤90 s.

## 9. Environment variables

`DATABASE_URL` (session pooler, **secret**), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (**secret**), `OPENROUTER_API_KEY` (**secret**), `TICK_SECRET` (**secret**), `WORKER_ID` (stable, `worker-1…9`), `WORKER_SLOTS` (3), `VBEAT_MAX_HEAVY` (2), `VBEAT_LEDGER_TZ` (UTC). Optional: `PORT` (8080), `WORKER_PUBLIC_URL`, `VBEAT_WORK_DIR` (`/tmp/vbeat-work`), `VBEAT_LOG_LEVEL`. Secrets are registered with the runner's `redact.py` by value at startup. Names only: `backend/deploy/env.example`.

## 10. Sprite findings

Verified on a scratch Sprite `vbeat-dev` (created for this task) unless marked *(docs)*:
- **Port**: the Sprite URL routes to **8080** by default; a service created with `http_port` routes there instead. Our status app listens on `PORT` (8080).
- **URL auth**: default is **authenticated**. From inside the Sprite, a request to its own public URL without credentials got `302 → sprites.dev/auth/sprite?...`. The Sprite's own doc (`/.sprite/docs/agent-context.md`) says the authenticated mode accepts `Authorization: Bearer $SPRITE_API_TOKEN`, and that `sprite url update --auth public` makes it public (CLI; my Sprites tool has no such call, so I could not flip it and **did not test the Bearer call**). So the planner can reach a worker's `/wake` or `/preflight` either with a Sprite API token **plus** `X-Tick-Secret`, or after the URL is made public (then only `X-Tick-Secret` guards them; `/healthz` exposes counts only). Workers do not need either: they poll.
- **Awake / asleep: NOT established.** The Sprite's docs (`services.md`) say services persist across reboots, restart on crash (backoff 1 s → 60 s, reset after 30 s stable) and start on boot, and that a service with `http_port` **auto-starts when a request arrives, even if it was stopped**. They say nothing about sleep. Third-party web pages claim a running service counts as activity that keeps a Sprite awake; **I could not confirm it**: with the probe service running and nothing else, `get_sprite_info` reported `cold` after ~4 minutes, but the service process was not restarted (same pid and start time), so I cannot tell whether `cold` means the VM stopped. **Decide with a real test before relying on either behaviour** (start a worker service, leave it idle for 10+ minutes, check that it still claims a job). Billing is untested too.
- **Secrets**: the connector's `service_create` has no env parameter. Secrets are loaded by `deploy/run-worker.sh` from `~/.vbeat/env` (mode 600), so they are never in the service definition or git.
- **Machine**: 8 CPUs, ~16 GB RAM visible, 99 GB disk, Python 3.13.17, passwordless `sudo`, `apt-get` available, outbound internet works (pip, apt). **No ffmpeg preinstalled** (bootstrap installs it).
- **Network to Supabase**: the direct host `db.<ref>.supabase.co` resolves **IPv6 only** → use the session pooler. `aws-0-eu-west-1.pooler.supabase.com` and `aws-1-eu-west-1.pooler.supabase.com` resolve over IPv4 and accept TCP on 5432 (session) and 6543 (transaction); REST answers 401 without a key. The right pooler host (aws-0 vs aws-1) and the pooler username format (`postgres.<ref>`) come from the dashboard string. `psycopg-binary` has a cp313 wheel.
- **Checkpoints**: the connector can create/list/restore checkpoints of a Sprite. **Cloning a checkpoint into a *new* Sprite is not available through it** (restore is in place), so each worker must run `deploy/bootstrap.sh worker` itself. Untested.
- Not verified at all: running the worker on a Sprite (no `DATABASE_URL` was available to me), real memory use of 3 beats + 2 renders, whether the 8080 URL survives sleeping workers, Sprite billing.

## 11. Migrations (all **applied** to the live project, in order, each verified)

| file | what | applied |
|---|---|---|
| `001_claim_job_limits.sql` | per-kind limits from settings; attempts counted once; stale+`cancel_requested` → `canceled` | yes |
| `002_requeue_own_orphans.sql` | `requeue_own_orphans(worker)` | yes |
| `003_workers.sql` | table `workers` (RLS on, no policies) | yes |
| `004_beats_final.sql` | `beats.final_path/final_bytes` | yes |
| `005_storage_buckets.sql` | private buckets `renders` (50 MB), `previews` (10 MB) | yes |
| `006_spend_functions.sql` | `spend_today(tz)`, `project_spend(uuid)` | yes |
| `007_settings.sql` | `beat_concurrency 1→27`, `caps.beat_usd=0.5` added | yes |

New functions are executable by `service_role` only. Rollback text is in each file's header. `claim_job`'s old definition is in 001's header.

## 12. What Part 2 may change in the worker

Nothing, except: (a) new job kinds are added by new modules registered in `worker/loop.py:RUNNERS`/`KINDS`; (b) settings keys may be added; (c) if Part 2 needs a `beat.revert` job, add it as a new runner, do not edit `beat_job.py`. Behaviours Part 2 can rely on are exactly §1–§9.

## 13. Known unknowns and assumptions

1. `media` key = `media.filename` (assumption; the Part 2 upload endpoint must store the filename the Director will reference).
2. `settings.tick.secret` lives in the database (read by `vbeat_tick_if_work`); the worker uses `TICK_SECRET` from its environment. They must be equal; I did not change either.
3. Queued feedback arriving mid-run is not seen by that run (§5).
4. Beat-level cap is cumulative (§5). Free-plan 1 GB Storage will fill: previews are overwritten per version, finals per beat; export zips expire but are not yet deleted.
5. `SupabaseBudget` does small synchronous DB calls (one `select` before and one `insert` after every model call) on the event loop thread; a stalled database stalls that worker's beats for up to the 15 s statement timeout.
6. The worker's SQL (`db.py`) was run statement-by-statement against the live schema through the Supabase connector (in a rolled-back transaction), its placeholder shapes are unit-tested, and its logic was tested against an in-memory double; **`PgDb` itself has never run over a real psycopg connection** (no credentials were available), and neither has the Storage client (tested against a local HTTP server only; the Storage `list`/`delete_prefix` response shape used by `cleanup-test-data` is from memory of the API).
7. `export.build` zips with no compression and refuses zips over 50 MB; large exports need a paid plan or fewer beats.
