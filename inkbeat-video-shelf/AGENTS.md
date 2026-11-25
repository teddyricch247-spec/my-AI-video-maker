# AGENTS.md

Rules for any AI agent working in this repo (Google AI Studio, Claude, anything else).
This repo is a **video shelf** with **two video style modes** (both render 9:16 Shorts and 16:9 YouTube long form):

- **Mode 1 — 3D Cartoon (`skill/inkbeat-shorts`, default):** Three.js + WebGL2 + inverted-hull ink outlines, prebuilt 3D characters/cars/trees.
- **Mode 2 — 2D Paper Motion (`skill/inkbeat-paper`):** Flat-pastel 2D Canvas cutouts with 122 modular assets (12 rigged 2-bone IK characters, 37 gestures, 16 hand poses, 17 props, crowds, 7 skies, buildings, shops, 5 interiors + live writing whiteboards, 10 vehicles, weather FX, 9 story scenes). Use Mode 2 whenever the owner asks for **Mode 2**, **2D**, **paper**, **flat**, **cutout**, **explainer/whiteboard**, or **inkbeat-paper**.

**Keep the codebase light: never store generated animations, scene files, transcripts, audio stems, frames, or `.mp4`s inside the repo.** Write working scene `.js` files and temporary renders in `/tmp/inkbeat-work/` and `/tmp/inkbeat-renders/`, and save finished videos and scene code directly to Supabase (`videos` and `scenes` buckets). The website (`app/`) lets the owner switch/filter between Mode 1 (3D Cartoon) and Mode 2 (2D Paper Motion), group saved database videos into session folders, and Download or Delete any clip.

The owner works from a phone. Keep your replies short. End a draft render with the local `/tmp` render summary (`mode`, `s/frame`, duration, and `"not saved to Supabase yet — say save when ready"`); end a save with the **Watch** links.

## Read first

Before any video task, read the matching skill docs in order:

- **Mode 1 (3D Cartoon):**
  1. `skill/inkbeat-shorts/START_HERE.md`
  2. `skill/inkbeat-shorts/SKILL.md`
  3. `skill/inkbeat-shorts/objects/README.md` (when writing a new 3D scene)
  Use **Route A** (`pipeline/`). Do not install Remotion.

- **Mode 2 (2D Paper Motion):**
  1. `skill/inkbeat-paper/START_HERE.md`
  2. `skill/inkbeat-paper/SKILL.md`
  3. `skill/inkbeat-paper/assets/README.md` (122 modular 2D assets & coordinate guide)

## Supabase (already connected)

The shelf is wired to a real Supabase project. Nothing to configure and no secrets needed.

- `config/shelf.json` holds the project URL, a publishable key (safe to commit, it is meant to be public) and the bucket name.
- The public `videos` bucket exists, with open read/write/delete for that key. `supabase/setup.sql` is the record of it.
- Env vars `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` override the file if set. Do not invent values for them.
- If an upload fails with 401/403/404, stop and tell the owner the exact status. Do not try to fix it by creating other buckets or projects.

## One-time setup (every fresh sandbox)

Playwright is the only missing piece. Chromium and ffmpeg are already installed. Do not download another browser.

From the workspace root (note: if `inkbeat-video-shelf/` lives inside a parent repo with `bun.lock`, use `bun` at the outer root instead of `npm` so lockfiles stay consistent):

```bash
npm install                   # or bun install if bun.lock exists
npm i -D playwright-core      # or: bun add -d playwright-core   (only if missing)
```

Then run the preflight check for the chosen mode:

```bash
python3 skill/inkbeat-shorts/pipeline/doctor.py   # Mode 1 (3D)
python3 skill/inkbeat-paper/pipeline/doctor.py    # Mode 2 (2D Paper)
```

The skills' scripts find Playwright by looking in parent folders' `node_modules`, so a root install is picked up automatically. Fix any FAIL and run the doctor again until it passes. A numpy WARN is fine (it only affects optional QA; pass `--no-qa` if numpy is missing).

Check the Supabase connection from the repo root (safe to run again):

```bash
npm run bucket
```

It should print `Bucket "videos" is ready.`

## What the owner gives you, and what you do (start immediately)

The owner sends a **word-timestamp transcript** (one word per line, `0.112 - 0.176  If`) plus **reference photos** and/or a **prompt**. Do not ask questions or wait for approval: pick sensible defaults (Mode 1 unless Mode 2 / 2D / paper is mentioned), say them in one line, and start.

1. **Format.** 9:16 (Shorts) unless the owner says YouTube, long form, landscape or 16:9, or asks for both. Both = render each, same scene, `--aspect 9:16` and `--aspect 16:9`.
2. **Reference photos.** Look at them yourself and use them as a brief: colours, outfits and hair for the characters, the place, props, mood. Never copy a real person's likeness or any brand or logo.
3. **Scene (in `/tmp`, NEVER in the codebase).** Write `/tmp/inkbeat-work/<slug>.js` anchored to transcript word times, importing from the chosen mode's ready-made characters and props (`skill/inkbeat-shorts` vs `skill/inkbeat-paper`). Do NOT add new files into `pipeline/scenes/` or `.renders/`. One scene file serves both formats via `ctx.landscape`.
4. **Fast visual check (`--beatcheck`), then render `draft`.** Run `--beatcheck` first to generate `/tmp/inkbeat-renders/<slug>/beatcheck.jpg` (~16–20 keyframes in seconds) and fix any clipping, cropped heads, or caption collisions before rendering the full timeline. Full `draft` rendering writes only to `/tmp/inkbeat-renders/<slug>` (**it does not upload anything to Supabase**).
5. Reply with the mode used, `s/frame`, duration, and `"not saved to the database yet — say save when ready"`. Stop.

## Making a video

Write temporary scene code into `/tmp/inkbeat-work/<slug>.js` and renders into `/tmp/inkbeat-renders/<slug>` (never inside the codebase):

```bash
# Mode 1 (3D Cartoon):
python3 skill/inkbeat-shorts/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --beatcheck --out /tmp/inkbeat-renders/<slug>
python3 skill/inkbeat-shorts/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --mode draft --out /tmp/inkbeat-renders/<slug> --no-qa

# Mode 2 (2D Paper Motion):
python3 skill/inkbeat-paper/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --beatcheck --out /tmp/inkbeat-renders/<slug>
python3 skill/inkbeat-paper/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --mode draft --out /tmp/inkbeat-renders/<slug> --no-qa
```

Add `--aspect 16:9` for YouTube landscape renders in either mode.

- **Start with `--mode draft`.** Use `fast` or `final` only when the owner asks. (Mode 2 2D Canvas renders even faster than Mode 1 3D on CPU.)
- **9:16** (default): 1-2 word captions that pop on each word, moving camera. **16:9** (`--aspect 16:9`, YouTube long form): small full-sentence captions with only the spoken word highlighted, calm camera cuts.
- **Long videos are split into parts automatically.** Anything over `--part-seconds` (default 30) is cut into equal parts on pauses between words so parts stitch seamlessly.
- **No voice-over and NO music, ever.** Do not generate speech, TTS, or any music bed. Captions only + optional **SFX-only** stem (`--audio <file>`, or `--auto-sfx` in Mode 2 from scene markers).
- **No transcript?** Replace `--transcript ...` with `--seconds 20`. The scene's own words are used.
- **A run got cancelled or timed out?** Re-run the exact same command to resume.
- Transcript formats accepted: `0.112 - 0.176  If`, `[0.112 --> 0.176] If`, `0.112 0.176 If`, `If,0.112,0.176`, `00:00:01.120 - 00:00:01.480 If`, or a JSON list of `{word, start, end}`.
- Built-in reference scenes only:
  - Mode 1 (`inkbeat-shorts`): `beats_test`, `char_demo`, `char_preview`, `tree_road`.
  - Mode 2 (`inkbeat-paper`): `paper_test`, `city_demo`, `office_demo`, `explainer_demo`.
- A new story uses an external scene file in `/tmp/inkbeat-work/<slug>.js` (never saved inside `pipeline/scenes/`). Build it from ready-made assets (`objects/` or `assets/`). Do not redraw them, and do not edit skill files unless asked.

## Saving to the database (ONLY when the owner asks)

**Never upload on your own.** Upload directly to Supabase only when the owner asks to save, upload, publish, or put videos on the shelf. Save both rendered video(s) (`videos` bucket) and scene code (`scenes` bucket), then clean up `/tmp`.

1. From the `inkbeat-video-shelf` root, pass the render folder and `--scene-file` (for Mode 2, add `--style paper` or use `skill/inkbeat-paper/pipeline/publish.mjs` so the website tags and filters it as **2D Paper**):

   ```bash
   # Mode 1 (3D Cartoon):
   node scripts/upload.mjs /tmp/inkbeat-renders/<slug> <name> --folder <session> --scene-file /tmp/inkbeat-work/<slug>.js

   # Mode 2 (2D Paper Motion):
   node scripts/upload.mjs /tmp/inkbeat-renders/<slug> <name> --folder <session> --style paper --scene-file /tmp/inkbeat-work/<slug>.js
   ```

   To edit or re-render an older session later, pull its scene code back down to `/tmp`:
   ```bash
   node scripts/scenes.mjs pull <session>/<slug>.js /tmp/inkbeat-work/<slug>.js
   ```

   Add `--dry-run` first if you want to preview the names and sizes.

2. **Size rule.** Supabase's free tier rejects any file over 50 MB. Any file over 45 MB is re-encoded automatically (libx264, CRF 23, same resolution, audio copied untouched) in `publish.mjs`. Do not shrink by hand.

3. Names: `<name>.mp4`, or `<name>-part-01.mp4`, `-part-02.mp4` ... for several parts. Mode 2 files get `-paper`, and 16:9 files get `-16x9` so the website filters by style and shows landscape framing. It prints a `Watch:` and `Download:` link for each.

4. Clean up temporary render and scene files from `/tmp`: `rm -rf /tmp/inkbeat-renders/<slug> /tmp/inkbeat-work/<slug>.js`

5. Reply with the `Watch:` links (all parts, in order), the style & mode used, the seconds per frame, and the file sizes.

The website groups every video in the bucket into session folders, lets you filter between 3D Cartoon and 2D Paper Motion, and includes Download and Delete buttons on every clip.

## Deleting and listing

```bash
node scripts/delete.mjs <name.mp4>      # one or more names
node scripts/delete.mjs --all           # everything on the shelf
npm run list                            # what is on the shelf now
```

Delete only what the owner names. For `--all`, only when they say so.

## Do not

- Do not commit videos, frames, `node_modules`, `.env` files, or anything from `out/` or `.renders/`.
- Do not install Remotion or use `skill/inkbeat-shorts/templates/`. That route needs a GPU.
- Preserve the shelf's comic ink-and-paper aesthetic and mobile-first layout; do not break saved Supabase clip playback.
- Do not overwrite a starter app that is already in the repo. Keep a single `package.json` and a single `app/` folder. If the repo already has its own, merge: the shelf page in `app/page.js`, helpers in `lib/`, and the font in `public/fonts/` are the parts that matter.
