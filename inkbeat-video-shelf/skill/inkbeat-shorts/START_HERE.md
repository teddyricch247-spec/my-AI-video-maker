# START HERE (any agent, Claude or not)
Goal: turn a word-timestamp transcript (plus reference photos or a prompt) into a 3D toon-shaded cartoon mp4, **9:16 (Shorts, 1080x1920)** or **16:9 (YouTube long form, 1920x1080)**. No internet needed. **Start immediately and render; saving to Supabase happens only when the owner asks.**

**Keep the codebase clean:** never write generated scenes, transcripts, frames, or `.mp4`s inside the repo. Write temporary work in `/tmp/inkbeat-work/` and `/tmp/inkbeat-renders/`, and upload finished videos + scenes to Supabase.

1. `python3 pipeline/doctor.py`   (run from any folder; fix any FAIL line it prints, then re-run; if Playwright is missing and `bun.lock` exists, use `bun add -d playwright-core`)
2. Put the transcript in `/tmp/inkbeat-work/words.txt`, lines like `0.112 - 0.176  If` (start - end  word). Other common layouts are accepted (see `pipeline/make_video.py --help`).
3. Pick the format: 9:16 by default; `--aspect 16:9` for YouTube / long form / landscape. Reference photos are a brief for colours, outfits, place and mood (cartoon look-alikes only, never a real likeness).
4. Write the scene in `/tmp/inkbeat-work/<slug>.js` (copy `pipeline/scenes/char_demo.js`; relative imports like `../lib/rig.js` and `../../objects/...` resolve cleanly when passed via `--scene-file`).
5. **Fast beat check first (~3–5 s):** `python3 pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --beatcheck --out /tmp/inkbeat-renders/<slug>`. Inspect `beatcheck.jpg` to catch clipping, camera collisions, or awkward framing before rendering every frame.
6. Render a `draft` right away: `python3 pipeline/make_video.py --scene-file /tmp/inkbeat-work/<slug>.js --transcript /tmp/inkbeat-work/words.txt --mode draft --out /tmp/inkbeat-renders/<slug>` (add `--aspect 16:9` for YouTube; pass `--no-qa` if numpy is missing). Output: `/tmp/inkbeat-renders/<slug>/video.mp4` (or `part-01.mp4 ...` for >30 s), `sheet*.jpg` contact sheets (auto-generated unless `--no-sheet`), `parts.json`, and `report.json`.
7. Inspect the generated `sheet*.jpg` contact sheet(s), fix any remaining flaws, and reply with `s/frame` and file sizes—noting it is not saved to Supabase yet. `--mode final` only when the owner asks.

What the formats do:
- **9:16:** 1-2 word captions on each word, moving beat camera (about 56 beats/min).
- **16:9:** small full-sentence captions at the bottom, only the spoken word lit, calm camera (hard cuts on the word, a few slow zooms, `calm()` in `pipeline/lib/rig.js`).
- **Long videos** are cut into equal parts of at most 30 s on pauses between words; the parts are one continuous timeline and stitch seamlessly in an editor.
- **No voice-over and NO music are ever made.** The owner records the voice-over; `--audio` takes an optional **SFX-only** stem (sound effects only, never music).

Characters: import the prebuilt cast from `objects/` (see `objects/README.md`, previews in `objects/previews/`, example `pipeline/scenes/char_demo.js`). Check with `node objects/selftest.js`.

Read `SKILL.md` for the rules (camera beats, look, captions, audio). Objects (characters, cars, trees) follow the contract in SKILL.md section 0. Speed on 2 vCPU: draft ~0.1 s/frame, fast ~0.2 s/frame, final ~1 s/frame. Remotion is optional (route B, `references/remotion-route.md`); do not install it unless the machine has a GPU and you need the full post chain.

## Save to Supabase (ONLY when the owner asks)
8. From the shelf root: `node scripts/upload.mjs /tmp/inkbeat-renders/<slug> <name> --folder <session> --scene-file /tmp/inkbeat-work/<slug>.js` (uploads all video parts in order to `videos` and the scene code to `scenes`). Files over 45 MB are re-encoded automatically (libx264, CRF 23) because Supabase rejects >50 MB. 16:9 names get `-16x9`. Reply with the ordered `Watch:` links, mode, `s/frame`, and file sizes, then remove `/tmp/inkbeat-renders/<slug>` and `/tmp/inkbeat-work/<slug>.js`. `--dry-run` previews.
