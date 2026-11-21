# START HERE (any agent, Claude or not)
Goal: turn a word-timestamp transcript (plus reference photos or a prompt) into a 3D toon-shaded cartoon mp4, **9:16 (Shorts, 1080x1920)** or **16:9 (YouTube long form, 1920x1080)**. No internet needed. **Start immediately and render; saving to the shelf happens only when the owner asks.**

1. `python3 pipeline/doctor.py`   (run from any folder; fix any FAIL line it prints, then re-run; if Playwright is missing and `bun.lock` exists, use `bun add -d playwright-core`)
2. Put the transcript in a file, lines like `0.112 - 0.176  If` (start - end  word). Other common layouts are accepted (see `pipeline/make_video.py --help`).
3. Pick the format: 9:16 by default; `--aspect 16:9` for YouTube / long form / landscape. Reference photos are a brief for colours, outfits, place and mood (cartoon look-alikes only, never a real likeness).
4. Write the scene in `pipeline/scenes/<slug>.js` (copy `char_demo.js`; it frames both formats through `ctx.landscape`).
5. **Fast beat check first (~3–5 s):** `python3 pipeline/make_video.py --scene <slug> --transcript words.txt --beatcheck --out ../../.renders/<slug>`. Inspect `beatcheck.jpg` to catch clipping, camera collisions, or awkward framing before rendering every frame.
6. Render a `draft` right away: `python3 pipeline/make_video.py --scene <slug> --transcript words.txt --mode draft --out ../../.renders/<slug>` (add `--aspect 16:9` for YouTube; pass `--no-qa` if numpy is missing). Output: `<out>/video.mp4` (or `part-01.mp4 ...` for >30 s), `sheet*.jpg` contact sheets (auto-generated unless `--no-sheet`), `parts.json`, and `report.json`.
7. Inspect the generated `sheet*.jpg` contact sheet(s), fix any remaining flaws, and reply with the **Next.js Preview link** (`#drafts` on the dev app URL), `s/frame`, and file sizes—noting it is not saved to Supabase yet. `--mode final` only when the owner asks.

What the formats do:
- **9:16:** 1-2 word captions on each word, moving beat camera (about 56 beats/min).
- **16:9:** small full-sentence captions at the bottom, only the spoken word lit, calm camera (hard cuts on the word, a few slow zooms, `calm()` in `pipeline/lib/rig.js`).
- **Long videos** are cut into equal parts of at most 30 s on pauses between words; the parts are one continuous timeline and stitch seamlessly in an editor.
- **No voice-over and NO music are ever made.** The owner records the voice-over; `--audio` takes an optional **SFX-only** stem (sound effects only, never music).

Characters: import the prebuilt cast from `objects/` (see `objects/README.md`, previews in `objects/previews/`, example `pipeline/scenes/char_demo.js`). Check with `node objects/selftest.js`.

Read `SKILL.md` for the rules (camera beats, look, captions, audio). Objects (characters, cars, trees) follow the contract in SKILL.md section 0. Speed on 2 vCPU: draft ~0.1 s/frame, fast ~0.2 s/frame, final ~1 s/frame. Remotion is optional (route B, `references/remotion-route.md`); do not install it unless the machine has a GPU and you need the full post chain.

## Save to the shelf (ONLY when the owner asks, or via web UI)
8. The owner can preview drafts and tap **Save to shelf** directly in the Next.js app, or ask you to save. From the shelf root: `node scripts/upload.mjs .renders/<slug> <name>` (uploads all parts in order; or give one mp4). Files over 45 MB are re-encoded automatically (libx264, CRF 23) because Supabase rejects >50 MB. 16:9 names get `-16x9`. It prints `Watch:` and `Download:` links; reply with the ordered `Watch:` links, mode, `s/frame`, and file sizes. `--dry-run` previews.
