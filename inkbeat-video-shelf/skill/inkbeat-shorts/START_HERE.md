# START HERE (any agent, Claude or not)
Goal: turn a word-timestamp transcript (plus reference photos or a prompt) into a 3D toon-shaded cartoon mp4, **9:16 (Shorts, 1080x1920)** or **16:9 (YouTube long form, 1920x1080)**. No internet needed. **Start immediately and render; saving to the shelf happens only when the owner asks.**

1. `python3 pipeline/doctor.py`   (fix any FAIL line it prints, then re-run; once per fresh sandbox)
2. Put the transcript in a file, lines like `0.112 - 0.176  If` (start - end  word). Other common layouts are accepted (see `pipeline/make_video.py --help`).
3. Pick the format: 9:16 by default; `--aspect 16:9` for YouTube / long form / landscape. Reference photos are a brief for colours, outfits, place and mood (cartoon look-alikes only, never a real likeness).
4. Write the scene in `pipeline/scenes/<slug>.js` (copy `char_demo.js`; it frames both formats through `ctx.landscape`).
5. Render a draft right away: `python3 pipeline/make_video.py --scene <slug> --transcript words.txt --mode draft --out ../../.renders/<slug>` (add `--aspect 16:9` for YouTube). Output: `<out>/video.mp4`, or `<out>/part-01.mp4, part-02.mp4 ...` for anything longer than 30 s, plus `parts.json` and `report.json`.
6. Look at a few frames (a contact sheet) and fix the scene. `--mode final` only when the owner asks.

What the formats do:
- **9:16:** 1-2 word captions on each word, moving beat camera (about 56 beats/min).
- **16:9:** small full-sentence captions at the bottom, only the spoken word lit, calm camera (hard cuts on the word, a few slow zooms, `calm()` in `pipeline/lib/rig.js`).
- **Long videos** are cut into equal parts of at most 30 s on pauses between words; the parts are one continuous timeline and stitch seamlessly in an editor.
- **No voice-over is ever made.** The owner records it. Captions only; `--audio` takes an optional SFX/music stem (no voice).

Characters: import the prebuilt cast from `objects/` (see `objects/README.md`, previews in `objects/previews/`, example `pipeline/scenes/char_demo.js`). Check with `node objects/selftest.js`.

Read `SKILL.md` for the rules (camera beats, look, captions, audio). Objects (characters, cars, trees) follow the contract in SKILL.md section 0. Speed on 2 vCPU: draft ~0.1 s/frame, fast ~0.2 s/frame, final ~1 s/frame. Remotion is optional (route B, `references/remotion-route.md`); do not install it unless the machine has a GPU and you need the full post chain.

## Save to the shelf (ONLY when the owner asks; this repo's video-shelf setup)
7. From the repo root: `node scripts/upload.mjs .renders/<slug> <name>` (a render folder uploads all its parts in order; or give one mp4). Nothing to install, no secrets. A file over 45 MB is re-encoded first (libx264, CRF 23, same resolution, audio untouched) because Supabase's free tier rejects files over 50 MB. 16:9 names get `-16x9`. It prints `Watch:` and `Download:` links; reply with them. `--dry-run` previews.
