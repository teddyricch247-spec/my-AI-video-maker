# Look and ink

## Pipeline overview
Render the scene with three.js / R3F inside Remotion's `ThreeCanvas`, then run your own post chain (the community
postprocessing package rendered blank frames in headless tests, so a small hand-written chain is safer):

1. **Normal + depth pass**: render the scene once with a normal material (view-space normal in RGB, an object id in
   alpha) into a render target with a depth texture. Supersample this buffer 2× for anti-aliased lines.
2. **Edge pass** (fullscreen shader on the normal/depth buffer): writes a 1-px edge mask on the *near* side of each
   line.
3. **Grade + ink pass**: bloom add, exposure, highlight shoulder, sRGB encode, contrast, lift/gamma/gain, saturation,
   split toning, a light local-contrast sharpen; then draw the ink lines **on top of the graded image** so they keep
   their exact color; write the signed circle of confusion to alpha for the DOF pass.
4. **DOF pass**: gather blur that never spills a sharp foreground over a blurred background.
5. **Bloom**: soft-knee prefilter, a 13-tap downsample chain, tent upsample.
6. **Final**: vignette, dither against banding. No grain.

## The ink outline (the part that makes it look drawn)
Three edge tests, combined with `max()`:
- **Depth (silhouettes):** use the *second derivative of 1/z* across the 3×3 neighborhood, relative to 1/z at the
  center. 1/z is affine in screen space for planes, so slanted floors and walls produce no false lines, and the test
  is scale-invariant. Ink only when the center is nearer than its neighbors' average (near side of the edge).
  Threshold that worked: **0.07** (relative).
- **Normals (creases):** compare with the right and down neighbors (1 px, one-sided), only against geometry that is
  not clearly farther (that case is a silhouette). Threshold as `1 − cos(angle)`: **0.34**.
- **Object id (boundaries):** write a small integer id per object into the normal pass alpha; ink where a neighbor has
  another id and is not nearer. Solid along the whole boundary, no threshold to hover around, so it never dots.
  Gotchas: three forces alpha to 1 for opaque materials, so id materials need `transparent: true` with `blending:
  NoBlending`; number ids in traversal order every frame (never `Object3D.id`, a global counter that differs per
  browser tab); cache id materials by the id value (≈ 120 steps), never per object.

Options that each fixed a real artifact:

| option | does | fixed |
|---|---|---|
| one-sided depth-jump test **off** (weight 0) | the extra "hard jump" test also fires on planes seen at a grazing angle, hovering around the threshold | dashed, crawling lines on floors and walls |
| object-id edges **on** | inks every boundary between two objects | solid silhouettes with no depth threshold |
| skip ink below **2.5 px** projected thickness (cylinders by radius, boxes by middle extent) | sub-pixel sticks raster as dashes | dotted wires, stems, cage bars far away |
| flat normal for double-sided meshes in the normal pass | a wavy curtain flips facing row by row | a dotted crawling line along folds |
| no ink on very dense thin geometry (blind slats every 5 cm) | each slat was inked | crawling venetian blinds |
| custom shader materials get a camera-facing normal in the normal pass | only their depth silhouette is inked | noise on displaced surfaces (sea) |

Width: about 3 px at 1080 wide (scale with the render width); distance fade from ~8 m to ~30 m down to ~45% opacity
and ~60% width; ink color a very dark warm brown, never pure gray. **Wobble 0** (animated hand-inked wobble crawls).
Far ink is also lower in contrast (part of the aerial perspective below).

**Ink color and width per mood** (never neutral black; the colors are the `ink` values in `core/moods.ts`):
- day: `#1a1424`, ~3 px;
- dusk: `#1e0f14`, ~3.5 px;
- night: navy `#0c0c1e`, ~4.5 px;
- cold: `#0a1420`, ~3.5 px;
- lamp-lit interior: umber `#160c10`, ~4.5 px;
- golden: brown `#1e1008`, ~3.5 px on wides.

**Ink density:** ink pixels ≥ **2.5%** of the frame (a good reference measured 2.9%; night exteriors 3.5–5%, interiors
3–4.5%, sunset wides 1.5–2.5%). A first pass with ink only on the characters measured 0.3% and read flat.

**Which edges get lines:**
- the silhouette of every object at every distance;
- creases on boxy props (corners, eaves, frames, panels, table edges); soft round forms get only the silhouette;
- texture lines (planks, shingles, joints) are painted into the textures at 1–2 px (sets-and-materials.md);
- no lines on the sky, a sea surface, light shafts, fog or glows.

Characters get heavier ink than the set (an inverted hull on top of the post ink): see characters.md.

## Grade (the crisp pass)
Applied to every mood so each act keeps its color identity while staying crisp:
- lights: hemisphere/ambient ×0.58, key ×0.66, fill ×0.55, camera fill ×0.3, practical glow ×0.55; fog density ×0.3;
- bloom: threshold ≥ **1.15**, strength ×0.55, radius ~42 px, scatter 0.45, so only lamp cores bloom;
- exposure: compress the mood's exposure as `e × 0.45 + 0.75` (lower values read as murky: L\* 40 vs a reference ≈
  54);
- lift ×0.8 (or a deliberate tinted lift for Shorts; ink drawn after it stays true black), clarity sharpen ~0.22 (0.45
  pumped painted textures into grime, see sets-and-materials.md), vignette ×0.75 (corners ≈ 0.75–0.8 of the center),
  grain 0.
- **Premium pass for Shorts:** stronger key and rim (rim ≈ 1.6–2.8 vs key 3–5), hemisphere ≈ 0.7–1.0, a fresnel rim
  term in the toon material (~0.4), halation on highlights; outdoors haze and sun rays only far behind the subject.
- Night moods keep more floor light so blue reads as color, not black.

## Light follows the acts: recipes
- hook: clean daylight or warm tungsten;
- tension: **deep blue night (not black) plus warm practicals**;
- memory or fantasy: over-bright, high-chroma day;
- explanation: a **golden, glowing close-up** of the key object;
- noir reveal: hard blind or window patterns;
- ending: **golden sunset or pink dawn backlight** with long shadows toward the camera.

## Color: warm against cool, never a wash
- Every frame keeps a warm/cool complement: warm orange/ochre against ultramarine/violet (roughly half warm and a
  third cool pixels in good references). A blue scene keeps one warm accent; a warm scene keeps a cool counter-light
  (a window).
- No extra warm highlight tint on an already warm key (cap it around 0.55), or every lit surface turns one amber hue.
- Never raise saturation globally to fix a dull frame: fix the light.
- **Don't stack shade tints.** One soft neutral terminator in the toon ramp, with no colored core band. Pull the
  per-mood shadow tint ~30% toward neutral (a tint factor of 0.7), halve split toning (×0.5), and remove magenta from
  shade tints and ambient colors; leave a blue night shade untouched. Stacked tints turn every wall in shade pink and
  draw a visible mauve band on terminators.

## Shadows, night and blacks
- **Shadows are colored, never gray or black:** blue-violet at night (shadow b\* ≈ −39; a toon shade multiplier around
  [0.8, 0.86, 1.3]; a lavender-blue character night shadow); near-neutral cool by day. Cast shadows soft (PCF ~3 px)
  and tinted.
- **Night is luminous ultramarine, not murky:** sky `#141a5a` at the top → `#2a3a9a` → `#5a6ad0` at the horizon (the
  night sky in `core/moods.ts`) (the brightest band behind the subject); unlit faces L\* 25–35; big dark planes never
  below L\* 15.
- **Blacks:** a lifted plum or indigo floor (darkest fill around `#2f232e` warm, `#0a0a30` at night). Only ink and the
  nearest silhouettes go below L\* 8; near-black pixels 1–4.5% of the frame (a good reference ≈ 2%; 7% read heavy).
- **Height gradient:** sky or ceiling brighter at the top, ground darker at the bottom (top − bottom L\* ≈ +8.5), so
  Shorts captions sit over the darker lower part.

## Direction, practicals, distance
- The key comes from behind or the side (a moon or a low sun as a back light) so every silhouette gets a rim.
  Hemisphere-dominated light has no direction and reads cheap.
- Practicals use decay 2 and leave warm pools of light; **≥ 3 practicals in any night exterior**.
- Contact shadows under every prop and character.
- **Aerial perspective:** far objects get lighter and bluer at night and nearly sky-colored at dawn. Fog color = the
  horizon color, reaching ~50% at 60 m (FogExp2 density ≈ 0.0139).
- **The sun** is a gold disc (kept ≤ 0.8) with a small white-hot HDR core (only the core blooms) and thin rays; it
  keeps the sky hue (no cream wash) and stays a sensible size in frame (a huge sun washed the whole sky cream).
- **Lightning** lights only the sky and the rims, for 2–3 frames, never a full-frame white flash.

## Characters and materials
- Toon material: smooth wrap ramp (no hard bands), tinted shadows (see above), warm highlights, a rim term.
- Heads: whatever the head design, give them a **lit and a shadow side**: lower any "skin lift" so heads don't read
  flat white in cold moods. Character specifics (form shade, 3/4 heads, character ink, face lights): characters.md.
- A small per-character light rig: a face key ~40° off the lens on the scene key's side and a warm rim opposite, at
  most 2 such lights per shot.
- **Painted text on props must be unlit** (`MeshBasicMaterial`, true color): colored painted text under a warm key
  washes out. Labels with their own background can stay lit.
- Set textures and per-material recipes: sets-and-materials.md.

## Depth of field and shadows
- DOF per shot kind (max blur px at 1080 wide): wide 0.6, medium 1.4, close 2.4, macro 3.0. Focus distance = the
  subject.
- Shadows: quantize the shadow box size (2 m steps) and snap its center to whole shadow texels in the light's view
  plane, so static shadows are pixel-identical frame to frame. Patch three's PCF soft shadows: recent three.js
  versions rotate the taps by a screen-locked interleaved gradient noise, a stipple that crawls under any camera move;
  replacing that noise term with 0 at load (before any material compiles) keeps soft, stable edges.
- Set the shadow camera's projection **every render** and call `updateProjectionMatrix()` (R3F props don't).
- No ugly shadow bands: key shadow maps **4096²**, `shadow.normalBias` ≈ 0.02–0.03, `shadow.bias` ≈ −0.0005 (otherwise
  brims and ledges streak the surface under them).

## Measuring
- **For a target look, give Claude 5-10 frames from videos you like, for private analysis only: measure light, color
  and pacing, but don't copy their characters, designs, sets or other distinctive elements. Keep the frames outside
  the project and its git repo, and never ship or publish them.**
- Compare frames to reference frames by mean L\*, p5/p95, chroma, ink density, texture energy, edge density and
  corner/center ratio, but judge by eye first. Iterate until it matches.
