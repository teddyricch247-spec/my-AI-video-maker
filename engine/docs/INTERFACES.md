# vbeat interfaces (engine slice)

Later work depends on this file. Paths are relative to the repo root. Python 3.11+, ffmpeg + ffprobe on PATH.

## Commands (run against the fixtures; each prints ONE JSON object)
```
export PYTHONPATH=src            # or: pip install -e '.[sprite]'
python -m vbeat_sprite ingest --transcript tests/fixtures/transcripts/native.json --fps 30 --out out/i
python -m vbeat_sprite spec   --transcript tests/fixtures/transcripts/native.json --fps 30 \
    --from-word 0 --to-word 3 --scene tests/fixtures/scenes/good.js --assets tests/fixtures/assets \
    --width 1920 --height 1080 --idx 1 --out out/s            # -> out/s/spec.json
python -m vbeat_sprite strip  --spec out/s/spec.json --out out/strip [--times 0.4,1.5] [--png]
python -m vbeat_sprite frames --spec out/s/spec.json --times 0.5,1.5 [--size 960x540] [--format png] --out out/f
python -m vbeat_sprite check  --spec out/s/spec.json --level fast --out out/c     # or --level full
python -m vbeat_sprite markers --spec out/s/spec.json --out out/m
python -m vbeat_sprite video  --spec out/s/spec.json --out out/v [--size 1280x720] [--crf 18] [--preset medium]
python -m vbeat_sprite bench  --out out/b [--assets DIR] [--frames 60]
```
`--from-word/--to-word`: 0-based index or word id, inclusive. Python callers import `vbeat_sprite.api`
(`ingest, make_spec, strip, frames, check, video, markers, bench`); same results, no subprocess.

## JSON envelope (stdout, exactly one line; progress goes to stderr)
`{"ok","command","artifacts":{name:path},"report":obj|null,"timing_ms":{...},"error":null|{"type","message"[,"t"]}}`
- `ok` = the tool ran and produced what was asked. For `check`, `report.ok` is pass/fail and `ok` is true.
- Exit code 0: ok, or a scene fault (`error.type` in SceneError, LoadError, MarkerError, SceneTooLarge,
  RenderTimeout: the beat is broken, the tool is fine). Exit 1: tool error (SpecError, ValueError,
  TimelineError, FfmpegError, VerificationError, ...). Exit 2: UsageError (still one JSON object).
- All artifacts live under `--out`: transcript.json, spec.json, strip.jpg[/strip.png], frame_f<NNNN>.jpg|png,
  report.json, markers.json, video.mp4, bench.json. `video` fails (exit 1) if ffprobe disagrees with the request.

## Time model (vbeat_shared.timeline)
fps in 24/25/30/60; sample clock 48000; frame = (ms*fps+500)//1000; ranges are half-open [f0, f1) and beats are
contiguous. Cuts sit at the integer midpoint of the pause between words; first beat starts at 0; last beat ends
`tail_ms` (600) after its last word. Export sizes 1280x720, 1920x1080, 2560x1440, 3840x2160 (16:9 only); the logical
canvas is always 1280x720 and is scaled at render time.

## Beat spec (JSON; relative paths resolve against the spec file's directory)
```
{"project":{"fps":30,"width":1920,"height":1080},
 "beat":{"idx":3,"f0":300,"f1":450,"title":"","direction":"","mode":"technical|story|either","allow_blank_start":false},
 "words":[{"id":"w0101","text":"The","start_ms":10000,"end_ms":10180,"f0":300,"f1":305}],   // only this beat's words, absolute frames
 "scene":"scene.js", "assets_dir":"assets", "media":{"img1":"file.png"}, "params":{}}
```
Validation lists every problem at once. Words must lie inside [beat.f0, beat.f1). Beat-local time = (frame - beat.f0)/fps.

## Scene module (what agents write)
ES module, no imports, exports only `draw(rt, t)` (required, pure in t), `markers(rt)` (optional, returns
`[{id,t,kind}]`, t in beat-local seconds within 0..dur, kind in pop|tick|whoosh|thud|stamp|slide|chime|rustle), `meta`.
Frame n is drawn at t = n/fps. The runtime fills PAPER first.

## rt API
`rt.g, W, H (1280x720), fps, frames, dur, t`; `rt.words` = `[{id,text,start,end,i}]` (seconds, beat-local);
`rt.at(id, edge='start'|'end', offset=0)` -> seconds (unknown id throws, listing the 5 nearest ids);
`rt.range(idA, idB)` -> `{start,end,dur}`; `rt.param(name, dflt)`; `rt.rng(seed)`; `rt.ease={cl,lerp,eo,eio,eb}`;
`rt.A(delay, dur)`; `rt.layer(key,w,h)`; `rt.media(id)` (unknown or failed id throws); `rt.core`, `rt.palette`;
`rt.lib.get(id) | list() | draw(id,t,params) | markers(id,params)` (draw wraps save/restore; unknown id throws
"Unknown asset 'x'. Did you mean: ...").
Errors thrown by `draw` surface as `SceneError{t,message,stack}`.

## Assets
`assets/core/palette.js` and `assets/core/core.js` (frozen API), optional `assets/core/fonts.css`, then asset modules
exporting `assets = {"<id>": {meta, draw(g,t,params), markers?(params)}}` (duplicate ids throw). Manifest rule: if
`assets/manifest.json` exists its `"modules"` array (paths relative to assets/, `.js`, inside the dir) is used;
otherwise every `assets/**/*.js` except `core/` and `_dev/` is imported. Modules without an `assets` export are ignored.

## Checks (report: `{"ok","level","counts":{"error","warn"},"findings":[{"id","severity","t","message","data"}],"text","sampling","timing_ms"}`)
`text` has one line per finding, e.g. `C4 error @1.20s: text 'HELLO' exceeds right edge by 34px` (C1 uses `L<line>:<col>`);
no findings -> `OK: no findings`. `fast` = C1, C2, C3 (every 1.0 s), C6. `full` = all, C3 every 0.5 s.
| id | sev | meaning |
|----|-----|---------|
| C1 | error | lint: Math.random, Date, performance, timers, rAF, fetch/XHR/WebSocket, eval/Function, import()/import/export other than draw,markers,meta, web storage, document, shadowBlur, assigning .filter |
| C2 | error | scene fails to load, pageerror, console.error, failed or blocked request, scene over 200 KB |
| C3 | error | draw throws (or never returns) at a sampled time or the last frame |
| C4 | error/warn | text box leaves 1280x720 by >2 px (error); within 48 px of an edge or effective font <14 px (warn) |
| C5 | error | two different texts overlap by >5% of the smaller box |
| C6 | error/warn | first frame >98.5% one colour (error unless allow_blank_start); same on last frame (warn) |
| C7 | error | pixels unchanged (mean abs diff <0.15 at 160x90, 0.25 s steps) for >=2.5 s |
| C8 | error | output differs between fresh pages, draw orders, or a redraw of the same t |
| C9 | error | a declared media file is missing, empty or does not decode |

## Browser entry (runtime/runtime.js, also loaded by the web preview)
`createRuntime({canvas, spec, baseUrl='/', sceneUrl=null})` -> `{rt, drawFrame(t,scale=1), markers(), meta, mediaStatus, info:{fps,frames,dur,words,assets,modules,source}}`.
It fetches `<baseUrl>_index.json`, imports `<baseUrl>assets/...`, and imports the scene from `sceneUrl` (default `<baseUrl>scene.js`).
`spec.media` must map ids to URLs. `drawFrame` is synchronous, throws `SceneError{t}`, and sizes the canvas to `1280*scale` x `720*scale`.

## Page API (window.vb; every call returns `{ok:true,...}` or `{ok:false,error:{type,message,stack,t?}}`)
`init(spec)`, `drawAt(t,scale)`, `capture({t,scale,format,quality})` -> `data` (base64), `captureBatch(times,opts)`,
`strip({times,cols,tileW,format})`, `pageChecks({level,...})`, `markers()`, `pixelHash(t)`, `lint(source)`.

## Served by the local server (127.0.0.1, random port; everything else 404)
`/runtime/*`, `/assets/*`, `/scene.js`, `/media/<id>` (declared only), `/_index.json` (module list + fonts flag).
Every response: `Cache-Control: no-store` and a CSP of `default-src 'none'; script-src 'self'; style-src 'self';
font-src 'self'; img-src 'self' data: blob:; connect-src 'self'`. Requests to other origins are aborted and reported (C2).

## Video
Silent H.264 yuv420p, BT.709 limited range tagged bt709, keyframe every second, +faststart, CRF 18 / preset medium.
Frame count == f1-f0 exactly, verified with ffprobe (codec, pix_fmt, size, frames, fps, colour tags, one stream).
