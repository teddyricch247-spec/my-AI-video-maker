# AGENTS.md

Rules for any AI agent working in this repo (Google AI Studio, Claude, anything else).
This repo is a **video shelf**. You make 3D cartoon videos (9:16 Shorts and 16:9 YouTube long form) with the skill in `skill/inkbeat-shorts`. **Keep the codebase light: never store generated animations, scene files, transcripts, audio stems, frames, or `.mp4`s inside the repo.** Write working scene `.js` files and temporary renders in `/tmp/inkbeat-work/` and `/tmp/inkbeat-renders/`, and save finished videos and scene code directly to Supabase (`videos` and `scenes` buckets). The website (`app/`) groups saved database videos into session folders and provides Download and Delete buttons on every clip.

The owner works from a phone. Keep your replies short. End a draft render with the local `/tmp` render summary (`s/frame` and `"not saved to Supabase yet — say save when ready"`); end a save with the **Watch** links.

## Read first

Before any video task, read these, in this order:

1. `skill/inkbeat-shorts/START_HERE.md`
2. `skill/inkbeat-shorts/SKILL.md`
3. `skill/inkbeat-shorts/objects/README.md` (only when writing a new scene)

The skill was written for Claude, but `START_HERE.md` works for any agent. Use **Route A** (`pipeline/`). Do not install Remotion.

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

Then run the preflight check (works from any folder by path):

```bash
python3 skill/inkbeat-shorts/pipeline/doctor.py
```

The skill's scripts find Playwright by looking in every parent folder's `node_modules`, so a root install is picked up automatically. Fix any FAIL and run the doctor again until it passes. A numpy WARN is fine (it only affects optional QA; pass `--no-qa` if numpy is missing).

Check the Supabase connection from the repo root (safe to run again):

```bash
npm run bucket
```

It should print `Bucket "videos" is ready.`

## What the owner gives you, and what you do (start immediately)

The owner sends a **word-timestamp transcript** (one word per line, `0.112 - 0.176  If`) plus **reference photos** and/or a **prompt**. Do not ask questions or wait for approval: pick sensible defaults, say them in one line, and start.

1. **Format.** 9:16 (Shorts) unless the owner says YouTube, long form, landscape or 16:9, or asks for both. Both = render each, same scene, `--aspect 9:16` and `--aspect 16:9`.
2. **Reference photos.** Look at them yourself and use them as a brief: colours, outfits and hair for the characters, the place, props, mood. Never copy a real person's likeness or any brand or logo. If a photo shows a person, make a cartoon character with similar clothes and colours only.
3. **Scene (in `/tmp`, NEVER in the codebase).** Write `/tmp/inkbeat-work/<slug>.js` for the story, anchored to the transcript word times, importing from the ready-made characters and props (`../../objects/...` and `../lib/...` resolve cleanly via `--scene-file`). Do NOT add new files into `skill/inkbeat-shorts/pipeline/scenes/` or `.renders/`. One scene file serves both formats: use `ctx.landscape` (see `scenes/char_demo.js`).
4. **Fast visual check (`--beatcheck`), then render `draft`.** Run `--beatcheck` first to generate `/tmp/inkbeat-renders/<slug>/beatcheck.jpg` (~16–20 keyframes in seconds) and fix any clipping or framing issues before rendering the full timeline. Full `draft` rendering writes only to `/tmp/inkbeat-renders/<slug>` (**it does not upload anything to Supabase**).
5. Reply with the `s/frame`, duration, and `"not saved to the database yet — say save when ready"`. Stop.

## Making a video

Write temporary scene code into `/tmp/inkbeat-work/<slug>.js` and renders into `/tmp/inkbeat-renders/<slug>` (never inside the codebase):

```bash
# 1. Fast keyframe check (~3-5s): renders beatcheck.jpg to catch framing/clipping early
python3 skill/inkbeat-shorts/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --beatcheck --out /tmp/inkbeat-renders/<slug>

# 2. Full draft render (also auto-generates sheet-*.jpg contact sheets unless --no-sheet)
python3 skill/inkbeat-shorts/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --mode draft --out /tmp/inkbeat-renders/<slug> --no-qa
python3 skill/inkbeat-shorts/pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --aspect 16:9 --mode draft --out /tmp/inkbeat-renders/<slug>-yt --no-qa
```

- **Start with `--mode draft`.** Use `fast` or `final` only when the owner asks. This sandbox renders on 2 CPUs with no GPU: about 0.1 s per frame in `draft`, 0.2 in `fast`, 1 in `final`. A 30 second clip is 900 frames.
- **9:16** (default): 1-2 word captions that pop on each word, moving camera. **16:9** (`--aspect 16:9`, YouTube long form): small full-sentence captions with only the spoken word highlighted, calm camera cuts.
- **Long videos are split into parts automatically.** Anything over `--part-seconds` (default 30) is cut into equal parts, each cut on a pause between words. The parts are consecutive frames of one timeline, so the owner stitches them seamlessly in their editor. A 2 minute video gives `part-01.mp4 ... part-05.mp4`. Do not change the part length unless asked.
- **No voice-over and NO music, ever.** Do not generate speech, TTS, or any music bed. The video has captions only; the owner records the voice in their own editor. `--audio <file>` is only for a **sound-effects-only (SFX) stem** (no voice, no music). Add story SFX when audio is requested and you can make them offline.
- **No transcript?** Replace `--transcript ...` with `--seconds 20`. The scene's own words are used.
- **A run got cancelled or timed out?** Run the exact same command again. Finished frames are skipped, so it resumes. If you edited the scene, the transcript or `objects/`, the old frames are wiped automatically.
- Transcript formats accepted: `0.112 - 0.176  If`, `[0.112 --> 0.176] If`, `0.112 0.176 If`, `If,0.112,0.176`, `00:00:01.120 - 0.00:01.480 If`, or a JSON list of `{word, start, end}`.
- Built-in reference scenes only: `beats_test`, `char_demo`, `char_preview`, `tree_road`.
- A new story uses an external scene file in `/tmp/inkbeat-work/<slug>.js` (never committed or saved inside `pipeline/scenes/`). Build it from the ready-made characters and props in `objects/`. Do not redraw them, and do not edit other skill files unless the owner asks.

## Saving to the database (ONLY when the owner asks)

**Never upload on your own.** Rendering and saving are separate. We no longer save videos through the UI—upload directly to Supabase only when the owner asks to save, upload, publish, or put videos on the shelf. Save both the rendered video(s) (`videos` bucket) and the generated scene code (`scenes` bucket), then clean up `/tmp`.

1. From the `inkbeat-video-shelf` root, pass the render folder and `--scene-file` (parts from the same session named `<session>-part1`, `<session>-part2`, etc., or uploaded with `--folder <session>`, are grouped automatically into one folder on the website):

   ```bash
   node scripts/upload.mjs /tmp/inkbeat-renders/<slug> <session>-part1 --scene-file /tmp/inkbeat-work/<slug>.js
   node scripts/upload.mjs /tmp/inkbeat-renders/<slug> <name> --folder <session> --scene-file /tmp/inkbeat-work/<slug>.js
   node scripts/scenes.mjs push /tmp/inkbeat-work/<slug>.js <session>/<slug>.js
   ```

   To edit or re-render an older session later, pull its scene code back down to `/tmp`:
   ```bash
   node scripts/scenes.mjs pull <session>/<slug>.js /tmp/inkbeat-work/<slug>.js
   ```

   Add `--dry-run` first if you want to preview the names and sizes.

2. **Size rule.** Supabase's free tier rejects any file over 50 MB. Any file over 45 MB is re-encoded automatically (libx264, CRF 23, same resolution, audio copied untouched) in `scripts/upload.mjs`. Do not shrink by hand.

3. Names: `<name>.mp4`, or `<name>-part-01.mp4`, `-part-02.mp4` ... for several parts (or `<session>/<name>.mp4` with `--folder`). 16:9 files get `-16x9` added so the website shows them landscape. It prints a `Watch:` and `Download:` link for each.

4. Clean up temporary render and scene files from `/tmp`: `rm -rf /tmp/inkbeat-renders/<slug> /tmp/inkbeat-work/<slug>.js`

5. Reply with the `Watch:` links (all parts, in order), the mode you used, the seconds per frame, and the file sizes.

The website groups every video in the bucket into session folders and includes Download and Delete buttons on every clip.

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
