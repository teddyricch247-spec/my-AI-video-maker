# vbeat-audio: frozen interfaces

Everything here is a contract with the other vbeat packages. Times are beat-local seconds unless stated.

## Constants
- `SR = 48000`. Allowed fps: 24, 25, 30, 60. `samples = frames * SR // fps`, always exact (`SR % fps == 0`).
- Output: 16-bit PCM, mono, 48 kHz wav with exactly `ctx.samples` frames. Default peak -6.0 dBFS.
- Marker kinds: `pop | tick | whoosh | thud | stamp | slide | chime | rustle`.

## Inputs (produced elsewhere, only these fields are read)
Engine beat spec: `{"project":{"fps":30,...},"beat":{"idx":3,"f0":300,"f1":450,...},
"words":[{"id":"w0101","text":"The","start_ms":10000,"end_ms":10180,"f0":300,"f1":305}],...}`.
Engine markers: `[{"id":"land","t":1.2,"kind":"thud"}]` (beat-local seconds; an object `{"markers":[...]}` also works).
Markers outside the beat are clamped to [0, dur].

## SFX spec (written by `spec`)
`{"fps":30,"frames":150,"samples":240000,"dur":5.0,"words":[{"id","start","end"}],
"markers":[{"id","t","kind"}],"peak_dbfs":-6.0,"seed":0}`.
Word time = `(frame - beat.f0) / fps`, clamped to [0, dur]. `frames = beat.f1 - beat.f0`. Beats are at most 60 s.

## Cue script contract
A Python file that imports only numpy, numpy.fft, scipy (signal, ndimage, fft), math, functools, itertools,
collections, dataclasses, typing and the injected module `synth`. It defines `render(ctx)` and returns a mono
float array. Shape:

    from synth import *
    def render(ctx):
        m = ctx.mix()
        m.add(ctx.marker('land'), wood_thunk(pitch=130), gain_db=0, name='thunk', anchor='land')
        return m.render()

Refused by the static check (finding A0 with line and column): any other import, `open exec eval compile input
breakpoint globals locals vars`, any `__dunder__` name or attribute, `getattr/setattr/delattr` with a non-literal
name (or a literal dunder or forbidden name), the attributes `os sys subprocess socket ctypes system popen load
save loadtxt savetxt fromfile tofile memmap genfromtxt` (plus a few side doors: see DECISIONS), `.format`
(use f-strings), `numpy.random` in any form and the `random` module (use `ctx.rng` or seeded synth functions).

### ctx
`ctx.sr ctx.fps ctx.samples ctx.dur ctx.words ctx.markers`; `ctx.at(word_id, edge='start'|'end', offset=0.0)`;
`ctx.marker(id)`; `ctx.marker_times(kind)` (sorted); `ctx.rng(label=0)` (numpy Generator derived from the spec
seed and the label); `ctx.mix()`. An unknown id raises `UnknownIdError` listing the 5 nearest ids.

### Mix
`Mix.add(t, x, gain_db=0.0, name=None, anchor=None, align='start'|'peak'|'end')`: `peak` puts the loudest moment
(argmax of a 10 ms smoothed envelope) at t. Parts outside the beat are cut and logged. `Mix.add_group(name,
[(t, x), ...])` logs one texture cue. A `Run` (from `type_keys`) is logged as a group. `Mix.render()` returns
exactly `ctx.samples` float32 samples.

## Runner output rules
Wrong length: pad with zeros or trim to `ctx.samples` and add A1 (never a failure for length alone). Then: NaN or
inf is error A2 (no wav is written); subtract the mean only if `abs(mean) > 1e-3` (warn A10); 5 ms linear fade in
and out; normalise so the sample peak equals `peak_dbfs`; write the wav. Same spec + same code gives a
byte-identical wav (see the determinism note in DECISIONS).

## CLI and API
`python -m vbeat_audio <command>`; `api.py` holds the functions, `cli.py` is a thin wrapper. Every command prints
exactly ONE JSON object on stdout (progress goes to stderr):
`{"ok":bool,"command":str,"artifacts":{name:path},"report":obj|null,"timing_ms":{},"error":null|{"type","message"}}`.
`ok` means the tool ran; `report.ok` means pass/fail. Exit code: 0 pass, 1 report failed, 2 tool failure.

| command | arguments | artifacts |
|---|---|---|
| spec | `--beat F [--markers F] --out spec.json [--seed N] [--peak-dbfs X]` | spec |
| render | `--spec F --cue cue.py --out DIR [--no-preview]` | wav, preview, cues, metrics |
| mux | `--video F --wav F --out F [--codec aac\|pcm_mov]` | video |
| catalog | `--out DIR` | audition, catalog_image, recipes, examples |
| docs | `[--out F] [--check]` | docs |
| selftest | (none) | none |

`render` writes `sfx.wav`, `sfx_preview.jpg`, `cues.json`, `metrics.json` into DIR. On A0 or A2 errors the wav
(and preview) is not written. `mux` writes AAC 192k 48 kHz stereo in `.mp4` (+faststart) or `pcm_s16le` in `.mov`,
copies the video stream, verifies with ffprobe, and fails loudly (deleting the output) when anything is off.

## Check report
`{"ok":bool,"counts":{"error":n,"warn":n},"findings":[{"id","severity","t","message","data"}],"text":"..."}`.
`severity` is error | warn | info (info is not counted). `ok` is true when there are no errors. `text` holds one
line per finding, e.g. `A4 warn @2.10s: 9 sound events in 5.0s (limit about 3); remove or group cues`.

| id | severity | meaning |
|---|---|---|
| A0 | error | script failed: syntax, forbidden construct, exception, timeout, memory kill, bad return type |
| A1 | warn / error | returned length differs from `ctx.samples` (error if off by more than 1 s) |
| A2 | error / warn | NaN, inf or silent output / raw peak under -50 dBFS |
| A3 | warn | 3+ consecutive samples stuck at the same extreme |
| A4 | warn / error | density above 1 event per 1.5 s / per 0.7 s (single = 1, group = max(1, ceil(span/0.6))) |
| A5 | warn | cue cut by a beat edge, or audible for more than 1.2 s |
| A6 | warn | over 25% of energy below 50 Hz or over 35% above 10 kHz |
| A7 | info | raw peak, rms, active-window rms |
| A8 | info | marker with no cue within +-80 ms |
| A9 | warn | anchor id unknown, or its time differs from the cue by more than 0.5 s |
| A10 | warn | DC offset removed by the runner |
