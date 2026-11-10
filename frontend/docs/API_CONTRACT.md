# FROZEN API CONTRACT v1

Conventions: JSON over same-origin HTTP, all paths under /api. Auth by HttpOnly session cookie; any 401 sends the UI to #/login. Errors: 4xx/5xx with {"error":{"code":"string","message":"human text"}}. Times are ISO-8601 UTC. Money is USD floats. URLs returned by the API are opaque: use them as given.

Enums:
 Project.status: setup | planning | plan_ready | building | done
 Beat.status: queued | running | waiting_user | needs_attention | approved | failed | skipped
 Session.status: idle | queued | running | waiting_user | flagged | failed | done
 Export.status: queued | running | done | failed

Objects:
 Media {id, filename, url, bytes}
 Project {id, name, fps, width, height, sfx_enabled, status, run_mode:'run_all'|'pilot', paused, word_count, duration_ms, warnings:[string], media:[Media], bible:string|null, plan_approved, cost_usd, beat_counts:{queued,running,waiting_user,needs_attention,approved,failed,skipped}, running_beat_id|null, director_session_id|null, created_at}
 Beat {id, project_id, idx, title, mode:'technical'|'story'|'either', direction, text, word_from, word_to, f0, f1, duration_s, start_tc, status, status_reason|null, summary|null, steps, cost_usd, session_id, scene_n|null, sfx_n|null, strip_url|null, updated_at}
 Check {ok, counts:{error,warn}, text}   (text = lines like "C4 error @1.20s: text 'HELLO' exceeds right edge by 34px")
 SceneVersion {n, created_at, created_by:'agent'|'user', strip_url, checks:Check, is_current}
 SfxVersion {n, created_at, wav_url, spectrogram_url, checks:Check|null, is_current}
 BeatDetail = Beat + {scene_versions:[SceneVersion], sfx_versions:[SfxVersion], words:[{id,text,start_ms,end_ms,f0,f1}]}
 Session {id, kind:'director'|'beat', beat_id|null, status, steps, cost_usd}
 Message {seq, role:'user'|'assistant'|'event', text, steps:[{name, summary, ok, image_urls:[string]}], created_at, queued:boolean}
 Export {id, status, progress:{done,total}, error|null, files:[{beat_idx,title,name,bytes,url}], zip_url|null, manifest_url|null, expires_at|null, created_at}
 Settings {models:{director,beat}, caps:{run_usd,daily_usd,max_steps,max_minutes}, beat_concurrency, sfx_peak_dbfs, kill_switch, spend_today_usd}
 ModelInfo {id, name, supports_tools, supports_images, price_in, price_out}   (USD per 1M tokens)
 PreviewBundle {fps, frames, dur, width, height, runtime_url, assets_base_url, scene_url, spec:object (opaque, pass unchanged to the adapter), media:{id:url}, wav_url|null}

Endpoints:
 POST /api/login {password} -> 204 | 401;  POST /api/logout -> 204;  GET /api/me -> {ok:true} | 401
 GET /api/projects -> [Project];  POST /api/projects {name,fps,width,height,sfx_enabled} -> Project;  GET /api/projects/{pid} -> Project;  DELETE /api/projects/{pid} -> 204
 POST /api/projects/{pid}/transcript (multipart field "file") -> {format, word_count, duration_ms, warnings:[string]}   (replaces any earlier upload; 409 once the plan is approved)
 POST /api/projects/{pid}/media (multipart "file") -> Media;  DELETE /api/projects/{pid}/media/{mid} -> 204
 GET /api/projects/{pid}/status?rev=N -> {rev, changed:false} or {rev, changed:true, project:Project, beats:[Beat]}   (the cheap poll; rev bumps on any change to the project, its beats or its sessions)
 POST /api/projects/{pid}/plan/start {instructions?} -> 202 {session_id}
 GET /api/projects/{pid}/plan -> {beats:[Beat], bible, validation:[string], ready, approved, session:Session}
 POST /api/projects/{pid}/plan/approve {run_mode:'run_all'|'pilot'} -> Project   (409 if not ready)
 POST /api/projects/{pid}/run/pause -> Project;  POST /api/projects/{pid}/run/resume -> Project
 GET /api/sessions/{sid}/messages?after_seq=N -> {session:Session, messages:[Message]}
 POST /api/sessions/{sid}/messages {text} -> 202 {message:Message}   (this is how the user chats with the Director and gives feedback to a beat)
 GET /api/beats/{bid} -> BeatDetail;  POST /api/beats/{bid}/approve -> BeatDetail;  POST /api/beats/{bid}/revert {scene_n?, sfx_n?} -> BeatDetail;  POST /api/beats/{bid}/retry -> 202 BeatDetail;  POST /api/beats/{bid}/skip -> BeatDetail
 GET /api/beats/{bid}/preview -> PreviewBundle
 POST /api/projects/{pid}/exports {beat_ids:[string]} -> 202 Export;  GET /api/projects/{pid}/exports -> [Export];  GET /api/exports/{eid} -> Export
 GET /api/models -> [ModelInfo];  GET /api/settings -> Settings;  PUT /api/settings (partial) -> Settings;  POST /api/kill {on:boolean} -> Settings

Polling rules: project status every 2.5 s while the tab is visible, 10 s hidden (use rev to skip all DOM work when unchanged); session messages every 2 s while Session.status is queued or running, else every 8 s; exports every 2 s while running. Cold start: the server may be asleep. A GET that fails with a network error, 502, 503 or 504 shows a banner "Waking the server (about a minute)..." and retries up to 6 times, 5 s apart; the banner disappears on success. Never auto-retry POST, PUT or DELETE.
