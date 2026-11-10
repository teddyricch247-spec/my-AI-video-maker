# Decisions

Recorded where the brief left room or where an experiment changed the plan.

## Environment and verification
- **Chromium flags**: Chromium silently ignores unknown flags, so "accepted" cannot be proven by a successful launch.
  Verified instead that each of `--font-render-hinting=none --disable-lcd-text --force-color-profile=srgb
  --hide-scrollbars --disable-gpu` appears in the browser process command line, and the flat-PAPER colour test passes.
- **ffmpeg**: checked on 6.1.1 before use: `-fps_mode cfr`, `-g/-keyint_min/-sc_threshold 0`, `-movflags +faststart`,
  `scale=out_color_matrix=bt709:out_range=tv`. The explicit matrix matters: without it swscale uses BT.601 under a
  bt709 tag and blue drifted by 3 (borderline for the +-3 test); with it PAPER decodes to within 1 of the source.
- **acorn**: vendored `acorn.mjs` 8.16.0 (MIT, licence kept next to it) copied from a local install; no network was used,
  so the tokenizer fallback was not needed. It is self-contained ESM and loads only when linting.
- **pytest** was not installable in the sandbox (no network). Tests are plain pytest style (asserts, `pytest.raises`,
  `parametrize`, `tmp_path`) and were run with a small local stand-in runner kept outside the repo. Run real pytest once.

## Time model and ingest
- `ms_to_frame` and `samples_for_frames` accept integers only (floats with an integral value are tolerated) so rounding
  can never be hidden by float error. `samples_for_frames` raises if not exact (always exact for the four allowed fps).
- `beat_frame_range` requires `first=True` for a beat starting at word 0 and `last=True` for one ending at the last word;
  the CLI sets both automatically from the range. The tail uses the same integer rounding as `ms_to_frame`.
- Milliseconds are the source of truth; frames are a derived grid. When frames collide, only `f0` moves forward (and `f1`
  if needed to keep one frame minimum), the minimum change; each adjusted word counts once in the warning.
- Punctuation-only tokens merge into the previous word and extend its end; opening quotes/brackets prefix the next word;
  a leading stray token is dropped with a warning. Invalid times (missing, negative, end<start) drop the word with one
  aggregated warning listing up to three examples. Zero-length words are valid input.
- Caption cues: words split on whitespace, time shared by character count (min weight 1); a leading dialogue dash, HTML
  tags and `{...}` style tags are stripped. Segments without word times in Whisper JSON are treated as cues.

## Runtime and page
- Scene `draw` errors are reported as **C3** (they carry the time); **C2** covers load failures, page errors,
  console errors, failed/blocked requests and the size limit. Each fault maps to exactly one ID.
  A scene that does not parse, or has no `draw`, is reported once, as C1 (the lint finding already names the cause;
  the failed load is not repeated as C2).
- The page API never throws across the Playwright boundary: every call returns `{ok,...}` or `{ok:false,error}`, so a
  scene fault is never confused with a tool fault. `capture` returns `{data}` rather than a bare string.
- The manifest-vs-glob choice and the fonts.css check are made by the Python server and exposed as `/_index.json`.
  This keeps runtime.js free of server specifics and avoids a 404 console error for an absent manifest (which would be a
  false C2). `fonts.css` is added only if it exists.
- `rt.media(id)` for a declared file that failed to load throws; C9 reports the load failure separately. Chromium's own
  "Failed to load resource" console error for a missing declared media file is suppressed so it is reported once, as C9.
- Scene import is part of `createRuntime` (after core, fonts, assets). Extra scene exports are reported by lint (C1),
  not by the runtime, so one cause gives one finding.

## Checks
- **C4/C5** hook `fillText/strokeText` on the main canvas only. Text drawn into off-screen layers and composited with
  `drawImage` is not tracked (position unknowable without following the blit). Text with alpha < 0.02 is ignored so
  fade-ins do not flag. The small-font warning uses each text's largest size over all samples (a scale-in animation
  starts tiny); bounds and overlap use every sample. Findings are de-duplicated per text/edge/pair with the first time.
- **C6** finds the modal colour in 4-wide bins, then counts pixels within +-6 per channel of the bin centre; measured on a
  640x360 render. **C7** compares 160x90 renders every 0.25 s; a run of unchanged steps >= 2.5 s fires once.
- **C8** page A draws t_a, t_b, t_a again; fresh page B draws t_b then t_a. Any mismatch (history or order dependence) fires.
  t_a and t_b are 25% and 75% of the beat. Skipped when draws already fail (C3).
- Sampling budget: if the first draw implies more than ~9 s of sampling, the C3 grid is thinned by a stride and the report
  says so (`sampling.thinned`), rather than dropping a check.
- A hang is caught by a watchdog: after the timeout (60 s per call, 120 s for a check run) the browser processes tagged
  with a per-session marker flag are killed (found via /proc, Linux only) and the call raises `RenderTimeout`. Check reports C3.
- Playwright serialises Python `0.0` as JS `-0`; report times are normalised so the text never shows `@-0.00s`.

## Rendering, CLI
- `video` encodes through a writer thread so render and encode overlap; `bench` reports a serial view (render all, then
  encode: conservative) and the pipelined view (the real path), each in fps.
- Every time-to-frame snap (strip/frames times, sampling grids) rounds half up, the same rule as `ms_to_frame`.
- `frames --size` accepts any 16:9 size up to 1280 wide (e.g. 960x540). Times outside the beat raise instead of clamping.
- Scene faults exit 0 with `ok:false`; tool errors exit 1; usage errors exit 2. Argparse errors still print one JSON object.
- The runtime directory is found relative to the repo (editable install); override with `VBEAT_RUNTIME_DIR`.
- `__init__.py` files were added to the two packages (needed for imports); no other files beyond the requested layout
  except test helpers and fixtures under `tests/`.
