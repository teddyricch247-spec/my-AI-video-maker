# START HERE — Mode 2 (`inkbeat-paper`, 2D Paper Motion)

Goal: turn a word-timestamp transcript (plus reference photos or a prompt) into a warm flat-pastel **2D paper-cutout animated mp4**, in **9:16 (Shorts, 1080x1920)** or **16:9 (YouTube long form, 1920x1080)**. No internet needed. **Start immediately and render; saving to Supabase happens only when the owner asks.**

**Keep the codebase clean:** never write generated scenes, transcripts, frames, or `.mp4`s inside the repo. Write temporary work in `/tmp/inkbeat-work/` and `/tmp/inkbeat-renders/`, and upload finished videos + scenes to Supabase when asked.

1. `python3 pipeline/doctor.py` (run from `skill/inkbeat-paper`, or by full path from any folder; fix any FAIL line and re-run; if Playwright is missing and `bun.lock` exists, use `bun add -d playwright-core`).
2. Put the transcript in `/tmp/inkbeat-work/words.txt`, lines like `0.112 - 0.176  If` (`start - end  word`). Other common timestamp formats are accepted (`make_video.py --help`).
3. Pick the format: `9:16` by default; `--aspect 16:9` for YouTube / long form / landscape. Reference photos are a brief for palette, outfits, characters, place, and mood (stylized flat-pastel look-alikes only, never a real likeness or logo).
4. Write the scene in `/tmp/inkbeat-work/<slug>.js` (copy `pipeline/scenes/explainer_demo.js` or `office_demo.js`; relative imports like `../../assets/...` and `../lib/cam2d.js` resolve cleanly via `--scene-file`).
5. **Fast beat check first (~2–4 s):**
   ```bash
   python3 pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --beatcheck --out /tmp/inkbeat-renders/<slug>
   ```
   Inspect `beatcheck.jpg` to catch character overlap, cut-off heads, or captions covering faces before rendering every frame.
6. Render a `draft` right away:
   ```bash
   python3 pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --mode draft --out /tmp/inkbeat-renders/<slug>
   ```
   Add `--aspect 16:9` for YouTube; pass `--no-qa` if numpy is missing. Output: `/tmp/inkbeat-renders/<slug>/video.mp4` (or `part-01.mp4 ...` for >30 s), `sheet*.jpg` contact sheets, `parts.json`, and `report.json`.
7. Inspect the generated `sheet*.jpg` contact sheet(s), fix any remaining flaws, and reply with `s/frame`, duration, and `"not saved to Supabase yet — say save when ready"`. Use `--mode final` only when the owner asks.

What the formats do:
- **9:16:** 1–2 word lowercase captions popping on each word at 70% height, moving 2D beat camera (`cam2d.js` panning/zooming across the 1280x720 virtual stage). Keep character heads in the upper 30–45% of the frame!
- **16:9:** small full-sentence captions at the bottom (~91.5% height), only the spoken word lit, calm camera (`calm2d()` cuts on word beats + subtle slow zooms).
- **Long videos** are cut automatically into equal parts of at most 30 s snapped to pauses between words so they stitch seamlessly in an editor.
- **No voice-over and NO music are ever made.** The owner records the voice-over in their own editor. `--audio` takes an optional **SFX-only** stem (or pass `--auto-sfx` to synthesize subtle one-shot SFX from your scene's `markers()`). Never add music.

Assets: import from `assets/` (122 prebuilt modular 2D assets across `people/`, `environment/`, and `story/`; read `assets/README.md` and browse contact sheets in `refs/`).

## Save to Supabase (ONLY when the owner asks)
8. From the shelf root:
   ```bash
   node scripts/upload.mjs /tmp/inkbeat-renders/<slug> <name> --folder <session> --style paper --scene-file /tmp/inkbeat-work/<slug>.js
   ```
   (Or run `node skill/inkbeat-paper/pipeline/publish.mjs ...` which defaults `--style paper`.) Files over 45 MB are re-encoded automatically (`libx264`, CRF 23). Mode 2 files get `-paper` and 16:9 files get `-16x9` so the website filters and displays them cleanly. Reply with the ordered `Watch:` links, mode, `s/frame`, and file sizes, then remove `/tmp/inkbeat-renders/<slug>` and `/tmp/inkbeat-work/<slug>.js`.
