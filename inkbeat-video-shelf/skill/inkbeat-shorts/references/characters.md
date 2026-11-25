# Characters

## Prebuilt cast (Route A): use first
`objects/character.js` ships a finished, rigged family in plain three.js (sam, ada, kid, elder) with acts, expressions, sockets and IK. Import it rather than building characters; see `objects/README.md` and `SKILL.md` section 11. The rules below explain why it is built this way and how to make a new family member.

## One character family, written down
- **Pick one character family and fix its rules before you build anyone:** proportions (head-to-body ratio, limb
  length and thickness), outfit logic, face layout and expression set, hair and hat rules, the palette. Write them in
  a short spec with numbers and keep every character in that family. A series reads as one world only when the whole
  cast follows one spec.
- Build characters as **real 3D meshes lit by the scene**, never 2D billboards turned to the camera.
- Don't fake a close-up by inflating a head: a wider lens closer to the face gives the cartoon size and keeps the
  proportions.
- Measure your design against reference frames (head width as a fraction of height, heads per body) and correct it
  until it matches; plain primitives (a perfect sphere on a plain box) read cheap; give heads and bodies a designed
  shape.
- The templates ship one finished family (`templates/src/inkbeat/char/family.ts`) and three example characters
  (`char/cast.ts`). Change the family numbers to make your own family, or the per-character overrides to make
  characters inside it.

## The shipped family
- **Proportions (h = soles to skull top):** an egg head 0.27 h wide (half-width 0.135 h), crown radius 1.06 and jaw
  radius 1.2 half-widths, depth 0.94; a superellipse crown (exponent 2.35) easing to a defined chin (1.82), a 22% jaw
  taper, fuller cheeks, a seeded wobble and a 2–5° hand-made roll; small ears.
- **Torso as wide as the head or wider** (0.28 h wide, 0.29 h tall, depth 0.72 of the width): `block` (broad
  shoulders, squarer cross-section), `barrel` or `pear`; a short skin neck between torso and chin.
- **Two-tone limbs:** sleeves in the top color (radius 0.026 → 0.021 h), pants in the bottom color (0.034 → 0.027 h),
  upper arm 0.125 h, forearm 0.112 h, the arm plane turned 9° forward; cuffs and pant hems; skin mitten hands (radius
  0.031 h) with a thumb; small shoes with a sole.
- **Face (drawn decal):** oval eyes with a highlight and a curved upper lid line, thick arched brows in a darker hair
  color, a hook or button nose, a mouth with a lip line and corner creases, cheek blush; optional lash flick, smile
  lines, mustache, beard, glasses (a mesh). Expressions: eyes (open, wide, half, closed, squint, angry), mouths
  (smile, grin, open, yell, flat, frown, o, smirk), brows (neutral, raised, worried, angry, none), look, blink, flush,
  sweat.
- **Palette:** a warm, real skin range (six tones), hair from black to snow, outfit colors as top / inner / bottom /
  shoes / accent. Outfits: shirt, vest, jacket, sweater, apron, overalls, each with seams, stitching, pockets and
  buttons. Hats: cap, flat cap, beanie, sun hat.
- **Kids:** head scale 1.25–1.35, a barrel torso, arm length ~0.8, thinner limbs; the legs come out shorter by
  themselves because the head takes more of the height. **Elders:** a pear torso, a 6–12° stoop at the hips (the head
  lifts back so the face still reads), gray or silver hair, glasses, smile lines.
- **Overrides per character:** `build` (headScale, torso, torsoWidth, torsoDepth, torsoHeight, limb, armLength, hand,
  stoop, neck) and `look` (skin, outfit, colors, hair, hairColor, hat, hatColor, hatBand, glasses, mustache, beard,
  ears, face style, seed). Pass the same `build` and `height` to `core/ik.ts`.

## Form and light
- **Lit side and shadow side** on every head (form shading); never flat white.
- **No pure-white skin clipping:** keep the brightest skin below white (about 0.93–0.95), with a soft spherical form
  shade toward the silhouette and the underside.
- Desaturate a warm key light on skin so lamp-lit skin keeps its own color; night heads go cool (lavender-blue).
- **3/4 heads:** keep the head yawed 20–35° off the camera. `faceCamera` turns the body halfway and the head the rest,
  stopping `threeQuarter` (default 22°) short of the lens. Dead frontal (`threeQuarter: 0`) in only about 1 close-up
  in 5; never pure profile (past ~70° a drawn face squashes).
- **Lit character materials:** a smooth wrap-lit toon material (a 256-px ramp, never 2–3 hard bands). Head, body and
  hat cast and receive shadows (a brim on the head, the head on the torso). A soft, tinted contact shadow under each
  character (radius ~0.6 head widths, opacity 35–50%). Never an unlit material times a tint multiply: that is the main
  cause of a flat, cheap look.
- Hats and other headwear are real meshes that cast shadows on the head; matte brims with no rim light; cap very
  bright hat colors at luminance ~0.8.
- Restrained gloss: keep clothing specular streaks low (~0.35 of a "vinyl" look reads as plastic), weaker hat
  highlights, the character rim ×0.85.

## Character ink
**Character ink is heavier than set ink.** An inverted hull on the head, ears, hair, hat, torso, limbs, hands and
shoes (≈ 3.4% of the head width on the head, lighter on limbs and hands, 1.3–1.75× on the underside, at least 2.4 px,
capped at 6.5 px), so together with the post ink it reads as an **8–10 px** dark stroke in close-ups. Use a colored
dark, not neutral black (the shipped family uses a deep indigo-brown, `#1b1a2a`); thin wire parts such as glasses skip
the post ink. Everything else in the set gets only the post-process ink (look-and-ink.md).

## Lights near faces
- At most **2 per-character lights per shot** (a face key ~40° off the lens on the scene key's side, a warm rim
  opposite).
- Colored practicals near faces (a screen, a UI panel, a neon): at most **~2 cd within 1 m** of the cast; a UI panel's
  point light ×0.6; bloom only on the emitter. Otherwise faces burn cyan or magenta in close-ups.

## Characters act
They never freeze while the camera moves:
- deterministic blinks (one per ~3.9 s, 0.1 s long, ~18% doubles, none in a framing's first 0.6 s);
- idle breathing, head turns toward the speaker, gestures on key words, small reactions (a wince, a sweat drop, a
  flush);
- mouth flaps (~7.5 Hz) only on quoted character lines, not under the narrator;
- gestures no faster than ~4 rad/s (faster arm jabs raise flicker flags).

## Likeness
Never a real person's likeness; every role is an invented, unnamed character.
