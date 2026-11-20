# AGENTS.md

Rules for any AI agent working in this repo (Google AI Studio, Claude, anything else).
This repo is a **video shelf**. You make 3D cartoon videos (9:16 Shorts and 16:9 YouTube long form) with the skill in `skill/inkbeat-shorts`. You render first; you upload them to Supabase only when the owner asks, and the website (`app/`) lists what is uploaded so the owner can play and download it.

The owner works from a phone. Keep your replies short. End a render with the file location and "not saved yet"; end a save with the links.

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

From the repo root, install the dependencies and add Playwright if `package.json` doesn't list it yet:

```bash
npm install
npm i -D playwright-core      # only if "playwright-core" is not in package.json
```

Then run the preflight check from the skill folder:

```bash
cd skill/inkbeat-shorts
python3 pipeline/doctor.py
```

The skill's scripts find Playwright by looking in every parent folder's `node_modules`, so the repo root install is picked up. Installing it at the root (and saving it) also stops a later `npm install` from removing it. If you can't install locally, `npm i -g playwright-core` works too.

Fix any FAIL and run the doctor again until it passes. A numpy WARN is fine (it only affects optional QA).

Check the Supabase connection from the repo root (safe to run again):

```bash
npm run bucket
```

It should print `Bucket "videos" is ready.`

## What the owner gives you, and what you do (start immediately)

The owner sends a **word-timestamp transcript** (one word per line, `0.112 - 0.176  If`) plus **reference photos** and/or a **prompt**. Do not ask questions or wait for approval: pick sensible defaults, say them in one line, and start.

1. **Format.** 9:16 (Shorts) unless the owner says YouTube, long form, landscape or 16:9, or asks for both. Both = render each, same scene, `--aspect 9:16` and `--aspect 16:9`.
2. **Reference photos.** Look at them yourself and use them as a brief: colours, outfits and hair for the characters, the place, props, mood. Never copy a real person's likeness or any brand or logo. If a photo shows a person, make a cartoon character with similar clothes and colours only.
3. **Scene.** Write `skill/inkbeat-shorts/pipeline/scenes/<slug>.js` for the story, anchored to the transcript word times, from the ready-made characters and props in `objects/`. One scene file serves both formats: use `ctx.landscape` (see `scenes/char_demo.js`).
4. **Render immediately**, as a `draft`. This only renders. **It does not save anything to Supabase.**
5. Reply with where the file is, the seconds per frame, and "not saved to the shelf yet, say save to put it there". Stop.

## Making a video

Always run from `skill/inkbeat-shorts`. Write renders to `.renders/<slug>` at the repo root (gitignored, survives between messages), as an absolute path.

```bash
cd skill/inkbeat-shorts
python3 pipeline/make_video.py --scene <scene> --transcript /path/words.txt --mode draft --out <repo>/.renders/<slug> --no-qa
python3 pipeline/make_video.py --scene <scene> --transcript /path/words.txt --aspect 16:9 --mode draft --out <repo>/.renders/<slug>-yt --no-qa
```

- **Start with `--mode draft`.** Use `fast` or `final` only when the owner asks. This sandbox renders on 2 CPUs with no GPU: about 0.1 s per frame in `draft`, 0.2 in `fast`, 1 in `final`. A 30 second clip is 900 frames.
- **9:16** (default): 1-2 word captions that pop on each word, moving camera. **16:9** (`--aspect 16:9`, YouTube long form): small full-sentence captions with only the spoken word highlighted, calm camera cuts.
- **Long videos are split into parts automatically.** Anything over `--part-seconds` (default 30) is cut into equal parts, each cut on a pause between words. The parts are consecutive frames of one timeline, so the owner stitches them seamlessly in their editor. A 2 minute video gives `part-01.mp4 ... part-05.mp4`. Do not change the part length unless asked.
- **No voice-over, ever.** Do not generate speech or use any TTS. The video has captions only; the owner records the voice in their own editor. `--audio <file>` is only for an SFX/music stem (no voice) and is optional. Add story SFX only if the skill's audio rules ask for it and you can make them offline.
- **No transcript?** Replace `--transcript ...` with `--seconds 20`. The scene's own words are used.
- **A run got cancelled or timed out?** Run the exact same command again. Finished frames are skipped, so it resumes. If you edited the scene, the transcript or `objects/`, the old frames are wiped automatically.
- Transcript formats accepted: `0.112 - 0.176  If`, `[0.112 --> 0.176] If`, `0.112 0.176 If`, `If,0.112,0.176`, `00:00:01.120 - 00:00:01.480 If`, or a JSON list of `{word, start, end}`.
- Scenes that exist: `beats_test`, `char_demo`, `char_preview`, `tree_road`.
- A new story needs a new scene file in `skill/inkbeat-shorts/pipeline/scenes/`. Build it from the ready-made characters and props in `objects/`. Do not redraw them, and do not edit other skill files unless the owner asks.

## Saving to the shelf (ONLY when the owner asks)

**Never upload on your own.** Rendering and saving are separate. Upload only when the owner says to save, upload, publish or put it on the shelf. A render that is not saved just stays in `.renders/<slug>`.

1. From the repo root, give the render folder (all parts go up in order) or one mp4:

   ```bash
   node scripts/upload.mjs .renders/<slug> <name>
   node scripts/upload.mjs .renders/<slug>/video.mp4 <name>
   ```

   Add `--dry-run` first if you want to preview the names and sizes.

2. **Size rule.** Supabase's free tier rejects any file over 50 MB. Any file over 45 MB is re-encoded automatically by the script (libx264, CRF 23, same resolution, audio copied untouched), a little lower quality that is only visible on very fine detail. Do not shrink by hand.

3. Names: `<name>.mp4`, or `<name>-part-01.mp4`, `-part-02.mp4` ... for several parts. 16:9 files get `-16x9` added so the website shows them landscape. It prints a `Watch:` and `Download:` link for each.

4. Clean up the frames (thousands of files): `rm -rf .renders/<slug>/frames`

5. Reply with the `Watch:` links (all parts, in order), the mode you used, the seconds per frame, and the file sizes.

The website shows every video in the bucket. There is no list to edit.

## Deleting and listing

```bash
node scripts/delete.mjs <name.mp4>      # one or more names
node scripts/delete.mjs --all           # everything on the shelf
npm run list                            # what is on the shelf now
```

Delete only what the owner names. For `--all`, only when they say so.

## Do not

- Do not commit videos, frames, `node_modules`, `.env` files, or anything from `out/`.
- Do not install Remotion or use `skill/inkbeat-shorts/templates/`. That route needs a GPU.
- Do not change the site's look unless asked.
- Do not overwrite a starter app that is already in the repo. Keep a single `package.json` and a single `app/` folder. If the repo already has its own, merge: the shelf page in `app/page.js`, the helper in `lib/supabase.js`, and the font in `public/fonts/` are the parts that matter.
