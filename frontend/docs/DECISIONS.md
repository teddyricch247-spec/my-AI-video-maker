# Decisions

Every choice that the brief left open, with the reason. No questions were asked.

## Architecture
1. **Lazy page modules.** `router.js` does `import('./pages/<name>.js')` per route, so the first load is index + core only (about 20 KB of JS: main, router, api, ui, format, poller). Each page exports `mount(view, params, app)` and returns a dispose function that stops its pollers and releases audio.
2. **One DOM helper, no templates.** `ui.js: el(tag, props, ...kids)` builds nodes; text always goes through `textContent`/text nodes. `src`/`href` pass through `safeUrl()` (same-origin paths, `#`, http(s) only), so a `javascript:` URL from an agent can never reach an attribute. Static test greps all `web/` code for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` and external URLs.
3. **Safe formatter** (`format.js: rich()`): paragraphs (blank-line separated, single newlines kept via `white-space: pre-wrap`), fenced code blocks (an unterminated fence runs to the end), `` `inline code` ``, `**bold**`. Everything else is literal text. Bold cannot contain code (kept trivial on purpose).
4. **Status polling** lives in `poller.js` (`watchProject`): one request per project, `rev` carried across pages in a module cache so a page opened from another tab renders instantly from the cache and unchanged polls do no DOM work. Pollers never overlap, refresh immediately when the tab becomes visible again, and use 2.5 s visible / 10 s hidden.
5. **Cards update in place by id** (`beats.js`): nodes are created once, patched with change-checked setters, and only moved when their index differs, so scroll position and focus survive polling (asserted in the e2e test with a node marker and `scrollY`).
6. **Kill-switch banner.** The contract only exposes `kill_switch` through `GET /settings`, so `main.js` refreshes it on route changes (at most every 15 s) and every 30 s while visible, with `quiet: true` (no retry, no banner). Settings and `POST /kill` update it immediately.
7. **Top bar tabs** are rendered for any route that has a project id; the beat page learns its project from `BeatDetail.project_id` and highlights *Beats*.

## Chat
8. **Draft survives** page changes because it is stored per session id in a module-level `Map`, and the textarea element itself is never re-created while the page lives (the Plan page's mobile tabs only toggle CSS).
9. **"queued" badge.** `Message.queued` can change after we have seen a message, but the contract only offers `after_seq`. While any user message is still queued the chat re-reads from `oldest_queued_seq - 1` (a tiny payload) and upserts by `seq`; otherwise it reads only after the last seq. Messages that are no longer queued are never re-rendered.
10. **Sending:** `Enter` sends, `Shift+Enter` newline (not while an IME is composing); the Send button is disabled while the request is in flight; right after a send the chat polls every 2 s for 15 s even if the server has not yet flipped the session to `queued/running`.
11. The beat page refreshes the beat immediately when the chat's session flips between busy and idle, instead of waiting for the next status poll.
12. The **Director chat becomes read-only** after approval (the plan is final); the input is disabled with a note.

## Preview
13. **postMessage protocol exactly as briefed** (no extra message types). The frame's origin is opaque, so both sides identify the sender with `e.source` (not `e.origin`) and send with target `'*'`. Payloads contain no secrets.
14. **The frame only reports failures**, so the parent clears the red error box when a seek produced no new error within 150 ms (and shows it again immediately if the next frame fails). The frame de-duplicates identical errors so a broken range does not flood messages.
15. **Clock:** while playing, `audio.currentTime` is the master clock if the WAV is seekable (checked via `seekable.end(0) > 0` after `loadedmetadata`), otherwise a `performance.now()` timer; `stage[data-clock]` shows which. The parent sends a seek only when the *frame index* changes, quantised to `n / fps`. Playback pauses when the tab is hidden and on page leave, and the audio element is released (`removeAttribute('src'); load()`).
16. **Frame numbering:** the readout shows the 0-based frame index (frame *n* is at *n / fps*), e.g. `frame 110 / 239`; the last reachable frame is `frames - 1`.
17. **Sound effects list** uses one shared `Audio` instance (Play toggles to Stop; starting another stops the previous; the preview is paused when a sound starts).
18. Stage aspect ratio comes from `PreviewBundle.width/height` (16:9 by default), the canvas fills the iframe via CSS.

## Plan, Setup, Export, Settings
19. **Plan redraw guard.** While beats build, `Beat` objects change constantly; the plan list is only redrawn when the plan's own fields change (title, mode, direction, text, timing, bible, validation, ready, approved).
20. **Approve** is enabled only if `ready && validation.length === 0 && !approved`, then asks for confirmation. Run mode radios: "Run all" (default) / "Pause after beat 1 (pilot)".
21. **Setup controls stay disabled until the project has loaded** (found by the mobile e2e run: an upload before the first poll rendered with `project === null`). Deleting an image asks for confirmation. Parse format is only known right after an upload in this tab; on reload the format row says "uploaded".
22. **Export defaults** to approved beats that have a scene; beats without a scene are disabled. Export cards update in place by id; export polling is 2 s while any export is queued/running and 20 s otherwise. Expired exports (`expires_at` in the past) hide their links and say "Export again to rebuild them".
23. **Settings** saves per section with partial `PUT /settings` bodies (`{models}`, `{caps}`, `{beat_concurrency, sfx_peak_dbfs}`), validates ranges client-side (concurrency 1 to 4, peak -12 to -1), and the kill switch is a `role="switch"` button with a confirm dialog in both directions.
24. **Login 401 vs redirect:** a wrong password shows an inline error; any other 401 sends the UI to `#/login` and remembers the hash to return to after logging in. `GET /api/me` is unused (see BACKEND_NEEDS).

## Visual and accessibility
25. Colours are CSS variables: PAPER `#F3EAD7` / INK `#221E1A` swap under `prefers-color-scheme`; TOMATO is the primary action, GREEN success/approve, MUSTARD warnings and the current-word highlight. System font stack only. Reduced-motion disables the pulse.
26. Tap targets: every button, link, select, range and summary should measure at least 44 px; the e2e test measures them on the main screens (login, projects, setup, plan, beats, beat, export, settings) and fails otherwise. Every saved screenshot is also checked for horizontal scroll. Checkbox/radio inputs are 22 px but sit in 44 px labels.
27. Mobile layout of the beat page puts the review actions straight after the beat info (before checks and versions) so *Approve* is one short scroll away; on desktop (>= 1000 px) actions and chat form a sticky right column.

## Mock server and tests
28. The mock serves `/runtime/*`, `/preview/scene/*` and `/files/*` with the headers in BACKEND_NEEDS.md and **without** cookie checks (the sandboxed frame has no cookie). `/api/*` has no CORS headers.
29. **Mock-only extras (not in the contract):** `--speed N` (timers N times faster; tests use 3), `--port 0`, and `POST /__test/expire` and `POST /__test/cold?s=N` (invalidate every login / answer 503 for N seconds). The brief's `--cold-start N` makes *every* request including static files 503, so the banner test loads the app first and uses `/__test/cold`.
30. The simulation is a 0.2 s tick thread under one lock: sequential builds (about 6 s per beat), beat 5 ends `needs_attention`, beat 9 fails on the first run, pilot pauses after beat 1, feedback re-runs a beat for about 5 s and creates a new scene version (or sfx version when the text mentions "sound").
31. The test file runs the mobile and desktop passes as separate processes (sync Playwright is not thread safe), each against its own fresh mock server.
