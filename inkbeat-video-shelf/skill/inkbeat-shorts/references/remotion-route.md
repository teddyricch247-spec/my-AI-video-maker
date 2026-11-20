# Route B: Remotion + React Three Fiber (needs network once, ideally a GPU)

Optional full-fidelity route. On a CPU-only machine it is slow (software WebGL); prefer the offline pipeline in SKILL.md section 0 for drafts. Render recipe, motion blur and the GPU lock are in render-and-qa.md.

## Start a project from `templates/`
`templates/` is a Remotion 4 starter with the whole look already wired. For a new project:
1. Copy the contents of `templates/` into the new project folder and run `npm install` (the one install this skill
   asks for; on the first render Remotion itself also downloads its Chrome Headless Shell, ~130 MB).
2. Render the demo still first: `npx remotion still src/index.ts Demo out/demo.jpg --scale=0.5 --gl=angle
   --timeout=240000`. Look at the `DemoHero`, `DemoWide` and `Demo-<mood>` compositions before building a set, so you
   know the baseline.
3. Build on it; don't rebuild what is there:
   - the post chain (ink, grade, bloom, DOF), toon and painted materials, moods (day, dusk, night, cold, lamp,
     golden), per-character cast lights and the shadow PCF patch;
   - the beat camera rig (`aim`, `poseAt`, shot presets in `core/shots.ts`);
   - IK (`solveArm`, `handWorld`, `holdInFront`) for props held in the hand;
   - all-white captions; a thick-liquid material (`core/liquid.tsx`);
   - motion blur (`DemoMoveSub` + ffmpeg `tmix`, render-and-qa.md); the word-anchored planner `plan/plan_src.py`;
   - a finished character system, `src/inkbeat/char/Character3D.tsx`, with one default family (`char/family.ts`: every
     proportion, palette and face-style number) and three example characters (`char/cast.ts`: an adult, a kid, an
     elder). Design your own cast by changing the overrides; keep every character of a film in one family
     (characters.md). `DemoCast` shows the three in one light.

For a target look, give Claude 5-10 frames from videos you like, for private analysis only: measure light, color and
pacing, but don't copy their characters, designs, sets or other distinctive elements. Keep the frames outside the
project and its git repo, and never ship or publish them.

