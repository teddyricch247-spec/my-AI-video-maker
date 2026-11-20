# Render and QA

## Render recipe
- `remotion bundle <entry> --out-dir=<bundle>` once per code change; remove a bundle dir you created that has no
  `index.html` before re-bundling (ask before deleting anything you didn't create). Bundles copy `public/` (they can
  be ~1 GB each): keep one per project and watch the disk; a full disk mid-render kills the render.
- `remotion render <bundle> <Comp> out.mp4 --gl=angle --timeout=240000 --concurrency=8 --codec=h264 --crf=16
  --pixel-format=yuv420p --muted`, then mux the master mix with ffmpeg (copy video, AAC 256k, `-movflags +faststart`).
  Don't use `-shortest` blindly when the picture is meant to outlast the audio tail.
- Tests: `remotion still` at `--scale=0.4`, concurrency ≤ 3. Render only the frames that changed.
- Long films: render in chunks (e.g., 600 frames), resumable; run the flicker check after each chunk and re-render a
  flagged chunk at half concurrency.
- "Chrome ran out of memory" / validation failures = too much load or a cache leak. A heavy scene can use well over 10
  GB of RAM at high concurrency: use 6–8 and never two renders at once.

## One render on the GPU at a time
Two renders sharing the GPU lost GL state and produced dark frames. Wrap every `remotion render` / `remotion still` in
a lock: `python scripts/gpu_lock.py -- npx remotion render …`. It takes an operating-system lock on an empty lock
file, waits while another render holds it, runs the command and lets the OS release the lock when the render ends
(even after a crash). It never writes to or deletes the lock file and refuses a path that is not an empty regular
file. On macOS/Linux the render inherits the lock, so a leftover child (e.g., a stray headless Chrome) keeps it until
it exits: if a render seems to wait forever, look for one. On Windows the render runs in a kill-on-close job object,
so killing the wrapper also ends the render.

## Motion blur (every Short)
1. A second composition at **4× fps and 4× frames**. Sub-frame k of output frame n renders at time `(n + ((k + 0.5) /
   4) · 0.5 − 0.25) / fps`: four samples across a **180° shutter** centered on the frame.
2. Captions are keyed to `n`, not the sub-time, so text stays sharp.
3. Average with ffmpeg: `tmix=frames=4:weights='1 1 1 1',select='eq(mod(n\,4)\,3)',setpts=N/30/TB` and `-r 30`.
4. Very fast moves separate into 4 ghost copies: lengthen them rather than adding samples.

## QA after every render
- `python scripts/flicker.py picture.mp4` → spikes + stride verdict (exit 3 = broken tab).
- `python scripts/analyze_pacing.py final.mp4` → beats/min, beats per 10 s, % still, % fast, hard cuts (ffmpeg scene >
  0.3), mean L\*. Targets for a Short: 56 ± 4 beats/min, still low (~5–20%), fast ≤ 35%, cuts ≈ 0, L\* ≥ 50.
- A 2 fps contact sheet: `ffmpeg -i v.mp4 -vf "fps=2,scale=120:-1,tile=16x8:padding=2" -frames:v 1 sheet.jpg`.
  Eye-check every framing for interpenetration, empty frames, set edges, unreadable tags. Then read it **muted**.
- Loudness: `ffmpeg -i v.mp4 -af ebur128=peak=true -f null -` → −14 LUFS integrated, ≤ −1 dBTP.
- Frame count = ceil(picture_end × fps). Check with `ffprobe -count_frames`.
- Dark-frame scan for long films: `signalstats` YAVG per frame.
- **Flicker QA on a Short:** the stride test can give false positives when camera-move spikes happen to share a
  residue (a flash or a whip can trip it). Compare the spike lists between versions: a new spike at the same frames as
  a code change is real; old move spikes are not. The steady-shot "zig" measure finds nothing on a Short that never
  holds still, so rank one-frame blips instead.

## Working budget
Agents and images cost a lot: look at contact sheets rather than single frames, cap image reads per step, test at 0.4
scale, render full resolution only for the pilot and the final, and keep sub-agents few with narrow briefs (their own
files, their own bundle dir, concurrency ≤ 3, a schema result: changed / proof / remaining). Review their work
yourself at full resolution: half-scale previews hide flicker.
