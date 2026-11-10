# Decisions

Decisions taken without asking (the brief said: decide and record). Newest topics last.

## Environment and verification
- **Tests were run with a minimal pytest stand-in.** `pytest` could not be installed (no network in the build
  sandbox). The tests only use `parametrize`, `raises(match=)` and the `tmp_path` argument, plus plain helper
  functions in `tests/helpers.py`. I wrote a ~100 line runner for those features
  and ran everything with it. Please run real pytest once; any difference would be a gap in my stand-in.
- **No ears.** Nothing here claims how a sound sounds. Recipes are verified by descriptors (duration, peak,
  centroid, attack, decay, band energy, partial frequencies, modulation rate) and by looking at spectrograms.
- ffmpeg 6.1, numpy 2.4, scipy 1.17, Pillow 12.1, Python 3.12 were used. Minimums are in DEPENDENCIES.txt.

## Contract details the brief left open
- Markers outside [0, dur] are clamped, never rejected (like word times). Unknown marker kinds are rejected.
- `report.ok` is false only when there is an error finding. Warnings pass but are listed first after errors.
- Exit codes: 0 pass, 1 report failed, 2 tool failure or usage error. Usage errors also print a JSON envelope.
- `render` writes no wav when the result is A0 or A2 error (nothing sensible to normalise). Other errors
  (A1 > 1 s, A4 error) still write the wav so a human can listen; the report still says fail.
- Beats are capped at 60 s (keeps temp files under the 20 MB file-size limit; the child never writes more than
  2 s beyond the beat, even when a script returns a huge array; the true length is still reported in A1).
- `A10` (new id): warning when the runner removes a DC offset. The brief asked for the warning but gave no id.
- Cue-log fields are mine: onset (first sample within 50 dB of the cue's peak), peak_t, end, audible_dur,
  cut_start_s, cut_end_s, clipped_audible, group span and member times.
- A4 group span = first onset to last onset (not to the end of the last sound). Density thresholds use a floor
  so that a hit plus one accent always fits a short beat: warn above max(2, dur/1.5) events, error above
  max(4, dur/0.7). For a 5 s beat that is 3.33 and 7.14.
- A5 "audible tail" is measured as the audible length of the whole cue (onset to the last point within 50 dB of
  its peak), because the style rule bans cues longer than 1.2 s. It is a superset of a tail-only measure.
- A5 "clipped" only fires when audible content (above -50 dB) was cut, so a long inaudible exponential tail at
  the very end of a beat does not warn.
- A8 counts a marker as covered when a cue's placement time, audible onset, peak time or any group member time
  is within 80 ms, so a swoosh started early with its peak on the marker is covered.
- A6 is computed after removing the mean (DC is A10's job, otherwise a DC offset would trigger A6 too).
- `ctx.at` does not clamp; Mix cuts whatever leaves the beat and logs it.
- `sweep()` returns a frequency trajectory in Hz (not audio), to feed `osc` and `bandpass_sweep`.
- `tick_times` curves: `ease_in` = gaps shrink (ticks accelerate), `ease_out` = gaps grow (ticks settle).
- `type_keys` returns a `Run` (ndarray subclass with `.events`) so `Mix.add` logs it as one group, and
  `type_key_events` returns `[(offset, key)]` for an explicit `add_group`. Both are deterministic.
- Extra files beyond the brief's layout: `analysis.py` (descriptors and STFT shared by Mix, checks, preview,
  catalog and tests), `tests/fixtures/make_fixtures.py` and `tests/fixtures/engine/` (engine inputs the example
  specs are built from), `sfx/examples` use word ids like `w0303` from those inputs.

## Added in the self-audit
- `numpy.fft` is allowed in cue scripts next to numpy and scipy (it is what `np.fft` resolves to).
- The preview time axis uses 0.5 s ticks up to 8 s, 1 s ticks above, and 5 s ticks above 30 s (beyond the brief).
- `catalog`, `selftest` and `docs` (without `--out`) need the source checkout (they read `sfx/examples`,
  `tests/fixtures`). Installed from a wheel they now fail with a clear error; an earlier build silently produced a
  catalog without examples and compared `docs --check` against a wrong path. `render`, `spec` and `mux` work
  from a plain install (verified in a venv, outside the repo).
- rlimits and `unshare` are Linux features. Each rlimit is applied best effort (a platform that rejects one, such
  as RLIMIT_AS on macOS, runs without it). Only Linux was tested.
- `soft_pop` is a plain sine as in the brief (an extra second harmonic I had added was removed).
- `type`, `bytes` and `format` are not available inside cue scripts (allowlist); everything the 7 examples and
  the documented language need is, and is tested by running it.

## Sandbox (honest summary)
- It is **defence in depth for model-written code, not a security boundary**. The machine holds no secrets and
  no network is needed. A determined script can probably escape the AST rules (numpy is a large surface).
- Layers: AST allowlist (before anything runs) -> child started with `python -I`, scrubbed environment, empty
  temp cwd, new session/process group, rlimits (CPU 15 s, address space 1 GB, file size 20 MB, 32 open
  files), 20 s wall clock that kills the group -> restricted `__builtins__` allowlist and a checking
  `__import__` inside the child -> the parent re-validates the returned array.
- Network namespace: `unshare -n` is probed once (`-n`, then `-rn`); if neither works the child runs without one
  and `metrics.json` records `"netns": false`. In the build sandbox it worked. Even without it, `socket` cannot
  be imported by cue code.
- Extra forbidden attribute names beyond the brief: `savez savez_compressed fromregex DataSource ctypeslib f2py
  testing io wavfile loadmat savemat datasets format format_map`. `.format` closes the classic
  `'{0.__class__}'.format(obj)` escape (f-strings are real expressions and are checked). Cost: `str.format` is
  unavailable; agents use f-strings. `from numpy import *` is refused because it would bind `load`/`save`.
- Because `__init__` is a dunder, `super().__init__()` is refused. Plain classes and dataclasses work.
- Timeouts: the child arms `faulthandler` so a hang or a CPU-limit kill reports the cue line it was stuck on.
- Print output of a cue is captured and cut at 4 KB; it is returned as `report.stdout` when non-empty.

## Determinism
- Same spec + same cue code gives byte-identical wavs on the same machine (tested). All randomness is seeded
  (`default_rng(seed)`, `ctx.rng`). numpy does not promise identical Generator streams across versions, so
  wavs may differ across numpy versions, not between runs.
- Known gap: `python -I` ignores `PYTHONHASHSEED` (verified), so iterating a `set` of strings inside a cue can
  change order between runs. The API doc tells agents to use `sorted()`.
- Nothing in the output depends on time or process ids; the wav header is written by the stdlib `wave` module.

## Audio design
- All recipes end with a short cosine fade (up to 40 ms for tails) and then peak-normalise to 0.5, so there are
  no clicks and no recipe exceeds 1.2 s. Modal sounds are excited with a Hann pulse whose length is matched to
  the pitch: a first version used one pulse length for everything and nulled the coin's partials (see below).
- `swoosh` / `paper_slide` use a band-pass whose centre moves; it is built by cross-fading 12 fixed band-passes
  along the log-frequency path (no filter-coefficient switching, so no zipper noise).
- `soft_pop` falls 1.35x to 1x exponentially over exactly 40 ms; `chime` ratios 2.756 and 5.404 are exact.
- Recipe levels: peak 0.5; the final normalisation is the only master level.

## What I changed after looking at the spectrograms
See the final report. In short: modal excitation pulse length
(coin_clink looked like two vertical smears instead of 3 partials), cloth_rustle low-pass order 2 -> 3 (too much
energy above 4 kHz), soft_pop pitch drop made exact, cloth_rustle flutter made measurable, stamp slap level raised.
