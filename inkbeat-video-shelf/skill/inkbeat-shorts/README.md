# inkbeat-shorts: a skill for 3D cartoon Shorts (offline pipeline + optional Remotion)

A skill that teaches an AI agent how to make **3D animated cartoon videos with three.js** (an offline plain-three.js
pipeline, or optionally Remotion + React Three Fiber). Start with `START_HERE.md`.

**Videos:** vertical Shorts with the camera grammar of viral 3D cartoon Shorts, and calm 16:9 long-form films. It
contains the rules and measured targets (beats per minute, % still, % fast, caption placement, ink density, texture
energy, loudness), a crisp toon look with a post-process ink outline, a physical-plausibility checklist, every flicker
cause found with its fix, a deterministic render recipe with motion blur, a QA routine, and a Remotion 4 starter
project. Every rule exists because a render was rejected without it.

## Install
Copy the `inkbeat-shorts` folder into your project's `.claude/skills/` folder:

```
your-project/
  .claude/
    skills/
      inkbeat-shorts/
        SKILL.md
        references/
        scripts/
        templates/
```

Claude Code picks it up automatically for matching tasks, or you can ask for it by name.

## What's inside
- `objects/`: prebuilt rigged characters (sam, ada, kid, elder), shovel prop, previews, self-test, manifest.
- `SKILL.md`: the short version of every rule, and how to start a project from `templates/`.
- `references/`:
  - `camera-and-editing.md`: the beat rig, transitions, long-form vs Short grammar, lens feel, inserts, retention
    beats;
  - `look-and-ink.md`: the ink outline, grade, act-to-light recipes, warm/cool color, shadows, night, blacks, aerial
    perspective, DOF;
  - `characters.md`: one character family, form shading, 3/4 heads, character ink, acting, likeness;
  - `sets-and-materials.md`: painted textures and per-material recipes, set dressing, real scale, sky, sea, weather;
  - `flicker-and-determinism.md`: every flicker cause found, its fix, how to hunt the next one;
  - `render-and-qa.md`: render recipe, motion blur, the GPU lock, QA tools and thresholds;
  - `shorts.md`: Shorts from scratch and cut from a long form, captions, sound-off tags;
  - `audio-and-voice.md`: voice-over workflow, music, SFX levels, loudness;
  - `production.md`: plan-first workflow, gates, budget, privacy.
- `templates/`: a Remotion 4 starter with the post chain (ink, grade, bloom, DOF), toon and painted materials, moods,
  cast lights, the shadow PCF patch, the beat camera rig and shot presets, arm IK, captions, a thick-liquid material,
  motion blur, the word-anchored planner `plan/plan_src.py`, demo compositions, and a character system with one family
  and three example characters (adult, kid, elder) to adapt.
- `scripts/` (Python 3 + numpy + ffmpeg):
  - `flicker.py VIDEO`: one-frame spikes and the broken-render-tab stride test (exit code 3 on a stride pattern);
  - `analyze_pacing.py VIDEO`: beats/min, % still, % fast, hard cuts, mean L\*;
  - `gpu_lock.py -- <render command>`: one render on the GPU at a time.

## What you need
- Offline pipeline (default): Node 18+, ffmpeg with libx264, Playwright (`npm i playwright-core`) plus any Chrome/headless
  shell, Python 3 (numpy only for QA). three.js is vendored in `vendor/`. `python3 pipeline/doctor.py` checks it all.
- Remotion route (optional), needs:
- Node.js for the Remotion starter (`npm install` inside the copied `templates/`). WebGL renders need `--gl=angle`.
  The first render downloads Remotion's Chrome Headless Shell (~130 MB) into `node_modules/.remotion/`.
- ffmpeg on PATH (motion blur averaging, muxing, loudness, contact sheets).
- Python 3 with numpy for `scripts/` and the planner.
- A text-to-speech service with word timings if you want narrated videos (any provider; the workflow is generic).
- Music you hold a license for.

**Licenses:** Remotion is not MIT: it is free for individuals and companies of up to 3 people; larger companies need a
Remotion Company License (remotion.dev/license). This MIT license covers only this skill's own files. Fonts in
templates/public/fonts/ are under the SIL OFL 1.1. Third-party code: see THIRD_PARTY_NOTICES.md.

## A first prompt
```
Using the inkbeat-shorts skill, start a new Short from templates/, render the demo, then plan a 30 s Short from my
VO in vo/. Show me the plan, then a look-dev sheet, then build and render it with motion blur and run the QA.
Stop after each step.
```

For a target look, give Claude 5-10 frames from videos you like, for private analysis only: measure light, color and
pacing, but don't copy their characters, designs, sets or other distinctive elements. Keep the frames outside the
project and its git repo, and never ship or publish them.

## Honest note
This is a starting point, not a finished pipeline. Your taste, your characters and your channel will need their own
rules: add them on top as you review renders, the same way these were written. Design your own character family by
changing the overrides in `templates/src/inkbeat/char/`.

## License
MIT, see [LICENSE](LICENSE). Remotion is not MIT: it is free for individuals and companies of up to 3 people; larger
companies need a Remotion Company License (remotion.dev/license). This MIT license covers only this skill's own files.
Fonts in templates/public/fonts/ are under the SIL OFL 1.1. Third-party code: see THIRD_PARTY_NOTICES.md.
