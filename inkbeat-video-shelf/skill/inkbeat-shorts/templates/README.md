# inkbeat starter (templates)

A self-contained Remotion starter for vertical (1080×1920) toon-shaded 3D Shorts. It gives you:
- ink lines, a color grade, bloom and depth of field;
- painted toon materials;
- act moods with colored shadows, and per-character light;
- a beat camera rig with shot presets;
- props held in the hand with IK;
- all-white captions;
- thick glossy liquids;
- motion blur.

It ships **one character family** with three example characters (an adult, a kid, an elder). Every design number of the family lives in `src/inkbeat/char/family.ts`: change it to design your own family, or change the per-character overrides (build, skin, outfit, colors, hair, hat, glasses, face style) to design characters inside it. Keep every character of one film inside one family.

## Use

```bash
cp -r templates my-short && cd my-short
npm install
npx remotion still src/index.ts Demo out/demo.jpg --scale=0.5 --gl=angle --timeout=240000
```

- Render the demo first.
- Then look at `DemoHero`, `DemoWide` and `Demo-<mood>` (day, dusk, night, cold, lamp, golden) before you build your own set.
- `DemoCast` (1920×1080) shows the three example characters in a row under one light: the family sheet.
- Always render with `--gl=angle`.

## Files

| Path | What it is |
|---|---|
| `src/inkbeat/char/family.ts` | the character family: proportions (fractions of the height), head shape, torso profiles, limb radii and lengths, face layout, skin / hair / cloth palettes, ink and light numbers; the `Build` overrides with kid and elder presets |
| `src/inkbeat/char/Character3D.tsx` | the character: an egg head with a drawn face and ears, a neck, a shaped torso with a painted outfit, two-tone limbs, skin hands, shoes, hair and hats that cast shadows, heavier ink hulls, a 3/4 head turn (`faceCamera`), auto blinks and breathing (`t`), walk, lean, stoop, a prop in the hand; `headOf`, `bodyYawOf` |
| `src/inkbeat/char/cast.ts` | three example characters (`CAST.adult`, `CAST.kid`, `CAST.elder`) to spread into `<Character3D>` |
| `src/inkbeat/char/skeleton.ts` | the layout of a build and the arm chain shared with IK |
| `src/inkbeat/char/geometry.ts` | head, ears, hair shells, hats, torso lathe, tapered limbs, hands, shoes, glasses |
| `src/inkbeat/char/face.ts` | the face decal: eyes, brows, nose, mouths, blush, lines, mustache, beard, sweat |
| `src/inkbeat/char/clothes.ts` | painted outfits (shirt, vest, jacket, sweater, apron, overalls), hair and hat textures |
| `src/inkbeat/char/material.ts`, `Inked.tsx` | the character material (wrap light, warm skin shade, rim, face decal, flush) and the inverted-hull ink |
| `src/inkbeat/char/handProps.tsx` | props for the hand: mug, key, book, phone |
| `src/inkbeat/mat/` | painted toon materials (plaster, brick, planks, roof tiles, stone, wood, metal, fabric, paper), sky, glow |
| `src/inkbeat/post/` | the post chain: normal / depth / id pass → edges → grade + ink → depth of field → bloom → final |
| `src/inkbeat/lookdev/` | look presets, `blendLook`, `withShot` (depth of field per shot size) |
| `src/inkbeat/core/shadows.ts` | the PCF dither patch, texel-snapped shadow boxes and the shot light |
| `src/inkbeat/core/moods.ts` | act moods (key, rim, hemi, lifted blacks, grade) |
| `src/inkbeat/core/castLight.tsx` | a per-character key and rim, so faces always read |
| `src/inkbeat/core/View.tsx` | `<View mood cam t focus blur>`: canvas, lights, sky, shadows and post |
| `src/inkbeat/core/shots.ts` | shot presets: `heroLow` (a low lens, the hero ~40% of the frame, 3/4 view, foreground spots), `medium`, `closeUp`, `wide` |
| `src/inkbeat/core/rig.ts` | the beat rig: `aim`, `poseAt` (PUSH / PULL / PUNCH / WHIP / MACRO on words), drift plus arc, shake |
| `src/inkbeat/core/ik.ts` | `handWorld`, `solveArm` and `holdInFront`: props sit IN the hand, below the face |
| `src/inkbeat/core/liquid.tsx` | thick dark liquids: `thickLiquidMaterial` (a dark floor exempt from the mood lift, a banded gloss, a wet rim, flowing streaks), `LiquidWave`, `LiquidPour`, `LiquidPool` |
| `src/inkbeat/core/kit.tsx` | mesh helpers (`M`, `boxG`, …), `Label` (painted tags), `Flame`, `Smoke` |
| `src/inkbeat/core/captions.tsx` | 1–2 word chunks, 92 px Poppins 800, centered at 70%, all white (optional accent color) |
| `src/inkbeat/core/frame.tsx` | font loading and motion-blur sub-frames |
| `src/demo/` | `Street` (a dressed set: the density reference), `Demo` / `DemoHero`, `DemoCast` (the family sheet), `DemoMove` / `DemoMoveSub` |
| `plan/plan_src.py` | a plan template: shots, accents and tags anchored to VO words; writes `src/plan.gen.ts` |

## Motion blur

Render `DemoMoveSub` at 120 fps, then average every 4 sub-frames:

```bash
npx remotion render src/index.ts DemoMoveSub out/sub.mp4 --gl=angle --timeout=240000 --concurrency=3
```

```bash
ffmpeg -i out/sub.mp4 -vf "tmix=frames=4:weights='1 1 1 1',select='eq(mod(n\,4)\,3)',setpts=N/30/TB" -r 30 -c:v libx264 -crf 16 -pix_fmt yuv420p out/move.mp4
```

## Rules the code does not enforce for you

- **Characters:** one family, written down (`family.ts`). Heads turned 3/4. Held props at chest height (`holdInFront`, with the character's `build` and `height`), never over the face.
- **Light:** a mood per act. No single-color washes: keep a warm/cool complement and colored shadows. Night is blue with a warm practical, not black.
- **Sets:** dressing in three depth layers, with ≥ 12 props in view. Every surface painted. Foreground props are small and sit at the frame edge.
- **Captions:** all white; if you add an accent color, at most one key word per sentence.
- **Tags:** only the story's key facts, about one per 15 s.
- **Liquids:** glossy and moving, with a rim light; scale them against the set.

## Fonts and licenses

| Asset | License |
|---|---|
| `public/fonts/Poppins-ExtraBold.ttf`, `Poppins-Bold.ttf` | SIL Open Font License 1.1 (`public/fonts/OFL-Poppins.txt`). Poppins is by Indian Type Foundry. |

Everything else (code, procedural textures, geometry) is generated in code. There are no image, model or audio assets.

Remotion is not MIT: it is free for individuals and companies of up to 3 people; larger companies need a Remotion Company License (remotion.dev/license). This MIT license covers only this skill's own files. Fonts in templates/public/fonts/ are under the SIL OFL 1.1. Third-party code: see THIRD_PARTY_NOTICES.md.
