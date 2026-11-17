# START HERE — inkbeat-player (instructions for the app-building AI)

**The user's chat message is a TRANSCRIPT.** It is the whole brief. Do not ask questions, do not propose a plan, do not wait
for approval. Read this file, then immediately write the files in section 3 and finish. If something is ambiguous, decide
and move on.

## 1. The product (hard spec)

A **Next.js app that is one 3D toon-shaded cartoon video of the transcript, with a single play button.**

- The page is a black screen with a 9:16 video in the middle and a round **play button** on top of its first frame.
- Tap play: the video plays with the transcript read aloud (browser voice) and white captions. At the end the play button
  comes back (replay). That is all.
- **Not in the product, ever:** download / save / export / render buttons, pause, scrub bar, timeline, progress bar, volume,
  fullscreen, share, settings, title, headings, labels, instructions, credits, loading text, debug panels, any other UI.
- **No rendering pipeline.** No Remotion, no ffmpeg, no Python, no scripts, no exporting frames. The video is drawn live in
  the browser by three.js. Nothing is ever rendered to a file.

The player (`src/player/`) already does all of this. **You do not write UI.**

## 2. What already exists (do NOT edit)

| Path | What it is |
|---|---|
| `src/app/` , `package.json`, `next.config.mjs`, `tsconfig.json` | Next.js shell. Keep the pinned versions. |
| `src/player/VideoPlayer.tsx` | The 9:16 stage, the play button, captions. |
| `src/player/playback.ts` | Clock + browser voice (speaks the transcript, keeps the picture in step). |
| `src/player/timing.ts` | Turns the transcript into word/sentence timings. `anchorOf(tl, "phrase")` finds a word's time. |
| `src/video/director.ts` | Picks the active shot, moves the camera, push-through between shots. |
| `src/video/beats.ts` | `beatsFor(tl, from, to)`: camera beats generated from the words (~56/min). |
| `src/video/types.ts` | `Shot`, `ViewSize`. |
| `src/inkbeat/` | The look engine: ink-outline post chain, toon + painted materials, 6 light moods, character system, camera rig, kit. Read the cheat sheet in section 6. |
| `src/examples/Street.tsx` | A dressed street set, as an example of density and materials (reuse it or copy its style). |
| `references/*.md` | Deeper notes (look, characters, sets, camera). Read them if you can. |

## 3. What YOU write (3 required files, plus any world files you need)

1. **`src/video/transcript.ts`** — put the user's message in `TRANSCRIPT`, verbatim (keep paragraphs as blank lines). Never
   paraphrase it. It is the only place the story text lives.
2. **`src/video/plan.ts`** — `TL`, `SHOTS`, `ACCENT_WORDS`, `HERO`/`HEAD` (see the existing file for the exact exports; keep
   them, because the player and director import them). Build the shots from the story (section 4).
3. **`src/video/Scene.tsx`** — the world and the acting: `export const Scene: React.FC<{ t: number; view: ViewSize }>`. Keep the
   existing structure (`direct(t)`, `<View {...view} ...>`, `<CastLight>`), replace the set and characters.
4. Optional: more files under `src/video/` (e.g. `World.tsx`, `Props.tsx`) for sets and props. Never add UI.

Order: transcript → plan → scene. Then do the self-check in section 8. Reply with 2–3 sentences at most.

## 4. From transcript to plan

**Never type a time.** Every shot start and every key moment is `at("a word or short phrase of the transcript")`
(`const at = (p, n = 1) => anchorOf(TL, p, n)` is already in `plan.ts`). Change the transcript and the film follows.

1. Read the transcript and split it into **story beats**: a new subject, a place or time change, a reaction, the payoff.
2. Make **one `Shot` per beat**, 2–5 seconds each (a sentence or two). Start each at the first word of its sentence or clause
   (`from: at("then she")`). Shot 1 has `from: 0`. Shots are consecutive: a shot ends where the next begins.
3. Give each shot: a `mood`, a `base` lens, a `focus` point, `blur`, `sky` (false indoors), and
   `beats: beatsFor(TL, from, nextFrom)`.
4. **Light follows the acts:** `day`, `dusk`, `night`, `cold` (cold interior), `lamp` (warm interior at night), `golden`
   (payoff). Give each act its own light; end on a warm payoff when the story allows.
5. **The key object is on screen in the first 2 seconds.** The first 40% is the fastest, the explanation the calmest, the last
   line gets a visual payoff (never a plain hold).
6. **Show what is said.** If the voice says someone opens, lifts, climbs, buys, or looks at something, build that object and
   show the whole action, big enough to read (an insert fills 45–60% of the frame height, held ≥ 2 s).
7. **Sound-off tags:** many viewers watch muted. Paint 1–3 word tags (a year, a price, a name, a label) on the key objects
   with `<Label>` from `core/kit.tsx`, about one per 15 s, only for the story's key facts. Bold, big, high contrast.
8. Where the transcript has no obvious setting, invent one that fits its topic (a shop, a street, a kitchen, a desk, a
   garden, a classroom). Use at least 2 different places or camera sides in a 30 s video so the picture keeps changing.
9. Optional `ACCENT_WORDS`: at most about one key word per sentence in an accent color; leave `[]` for all-white captions.

## 5. Look and camera rules (each one came from a rejected render)

**Look: crisp, not milky.** Clear key light with definite shadows; heads with a lit and a shadow side (the engine's
`CastLight` does this: always include it for every visible character); a saturated clean palette per act; bloom only on lamp
cores; mild depth of field; **no haze on the subject, no grain, no lifted washed-out blacks**. Bright day frames. Ink outlines
come from the post chain: do not add outline meshes. Warm against cool in every frame, colored (never gray) shadows, night is
luminous ultramarine. Glowing parts (`coreMat`) stay ≤ 1.0–1.2 so they don't burn to cream.

**Camera (vertical Short grammar):**
- No hard cuts: the camera *beats* are the transitions (`director.ts` does the push-through between shots).
- The camera is never still: `beatsFor` + the rig's drift handle it. Pushes outnumber pulls 2:1; small rolls inside orbits.
- Faces sit at **30–45% of the frame height** (use `aim(from, subject, fov, 0.38)`): captions own 70%, never cover a face.
- Lens feel: set shots at vertical fov 60–80°, low hero shots 85–95°, face close-ups 40–50° (38–62° everywhere reads flat).
  About 40% low angles (lens 0.3–1.2 m high), 20% high 3/4, something near the lens in about half the shots, 2–6° dutch only
  inside moves. Prefer 3/4 views of faces (20–35° off frontal), never dead frontal in most shots.
- **Beats accumulate inside a shot** (each push moves the lens closer): keep shots 2–5 s and the look point a few meters ahead
  of the lens (not 40 m away), or the camera flies through the subject.
- Moves between distant framings ≥ 0.85 s. Cycles of motion (mouths, bobbing, flames) ≤ ~2 Hz: faster reads as flicker.
- Foreground objects may frame a shot but never sweep across the subject during a move.

**Physical plausibility (check every shot):** hands and arms don't pass through tables, blankets, laptops or books; doors don't
hit heads; props are real scale (a book ≈ 0.6 × head width) and held IN the hand (`hold="mug" | "key" | "book" | "phone"`, or
`core/ik.ts`), never floating; floating UI/panels are anchored to something; the camera is never inside geometry, never above a
missing ceiling, never past the edge of the set (an interior never shows sky); no empty sky mid-move.

**Set density:** ≥ 12 props in every framing across three depth layers (foreground, the character's ground, the background),
painted textures on every large surface (`tex="plaster" | "brick" | "planks" | "stone" | "wood" | "metal" | "fabric" | ...`),
toy-like rounded props, one warm practical light per scene. Walls and slabs never share a coplanar face (offset ≥ 1 cm; decals ≥ 3–4 mm
proud), bars and frames only touch, never overlap (overlaps ink a flickering black blob).

**Characters:** one written-down family (`CAST`: adult, kid, elder; change `look` and `build` overrides for more). Keep every
character of the film in that family, always acting (pose, face, head tilt), never a real person's likeness. No real brands or logos.

## 6. Engine cheat sheet

```tsx
// the frame
<View {...view} mood={moodOf("dusk")} cam={cam} t={t} focus={headPoint} blur={1.4} sky exposure={0}>…</View>
// moods: "day" | "dusk" | "night" | "cold" | "lamp" | "golden"        (core/moods.ts)

// characters (char/Character3D.tsx, char/cast.ts, char/family.ts: SKIN, HAIR, CLOTH palettes)
<Character3D {...CAST.adult} position={[x,0.16,z]} yaw={rad /*0 faces +z*/} t={t}
  face={{ eyes: "open"|"wide"|"half"|"closed"|"squint"|"angry", mouth: "smile"|"grin"|"open"|"yell"|"flat"|"frown"|"o"|"smirk",
          brows: "none"|"neutral"|"angry"|"worried"|"raised", look: -1..1, flush: 0..1, sweat: boolean }}
  pose={{ armL: [shoulderDeg, elbowDeg], armR: [..], armRFwd: deg, lean: deg, bob: n, walk: radians, headTilt, headNod, headYaw }}
  hold="mug"|"key"|"book"|"phone"  holdSide="R"  faceCamera={cam.pos} />
// custom character: { height, build: {...}, look: { skin, outfit: "shirt"|"vest"|"jacket"|"sweater"|"apron"|"overalls",
//   colors: {top, inner, bottom, shoes, accent}, hair: "none"|"crop"|"swoop"|"curly"|"bob"|"bun"|"sides", hairColor,
//   hat: "none"|"cap"|"flat"|"beanie"|"sunhat", glasses, mustache, beard, face: {nose, blush, brow, lines…}, seed } }
headOf(position, height, build)            // the head point, for focus / CastLight / aim
<CastLight at={head} cam={cam.pos} mood={m} />   // one per visible character (keep it mounted; k={0} turns it off)

// set building (core/kit.tsx): boxG(w,h,d) cylG(rt,rb,h) sphG(r) coneG(r,h) torG(r,t)
<M g={boxG(2,1,0.5)} c="#d6a137" tex="planks" p={[x,y,z]} r={[rx,ry,rz]} s={1} />   // toon mesh
<mesh geometry={sphG(0.1)} material={coreMat("#ffd890", 1.0)} />                    // glowing core (blooms)
<Label text="1994" p={[x,y,z]} w={1.2} h={0.4} fg="#fff" bg="#c83a3a" font={0.6} />    // painted text panel for sound-off tags
<Flame p={[x,y,z]} t={t} />  <Smoke p={[x,y,z]} t={t} />                              // animated by t only
// core/liquid.tsx: thick liquid material · core/ik.ts: solveArm / handWorld / holdInFront (props in hands)
// examples/Street.tsx: House, Window, Awning, Crate, Barrel, LampPost, Street, as a density guide

// camera (core/rig.ts, core/shots.ts)
aim(from, subjectPoint, fov, faceFraction)          // a lens aimed so the subject sits at 38% from the top
heroLow / medium / closeUp / wide({ feet, height, facing, side })  // -> { cam, focus, blur, fg: V3[] foreground spots }
moves in beats: PUSH PULL PUNCH MACRO ORBIT_L ORBIT_R CRANE_UP CRANE_DOWN DOLLY_L DOLLY_R TILT_UP TILT_DOWN WHIP SHAKE
```

Units are meters. In the example street the road top is y = 0 and the sidewalk top is y = 0.16 (`HERO` stands on it); a character's soles stand on whatever surface you put under it.

## 7. Live-playback rules (this runs in a browser, in real time)

- **Every frame is a pure function of `t`.** No `Math.random`, `Date`, `performance.now`, no state mutated across renders,
  no `useState` in the scene. Animate only with `t` (sin/lerp/smoothstep of seconds or of `at(...)` times).
- **Keep the number of lights constant across shots** (a changed light count recompiles shaders and stutters). Use intensity 0,
  not unmounting, for lamps that are "off"; render the same `CastLight` for every character in every shot.
- Create geometry with the `boxG/cylG/...` helpers (they are cached); don't build new geometries or textures per render.
  Keep the whole world modest (a few hundred meshes): it must hold 30 fps on a phone.
- Show only what the camera needs: it is fine (and faster) to hide far-away areas (`visible` by `d.index`) per shot.
- Fonts are already loaded by the player. Only Poppins is available; do not add other fonts or network assets.
  **No external images, models, audio or fetches**: everything is procedural.
- Do not add `localStorage`, analytics, or any network call.

## 8. Self-check before you finish

- [ ] `TRANSCRIPT` is the user's text, verbatim.
- [ ] `plan.ts` exports `TL`, `SHOTS`, `ACCENT_WORDS`, `HERO`, `HEAD` (the player and director import them); no typed seconds
      except `from: 0`; every `at("…")` phrase really appears in the transcript.
- [ ] Shots are consecutive, 2–5 s each, and each has its own framing; the light changes with the acts.
- [ ] The story's key objects and actions are built and visible; at least one sound-off tag on the key object.
- [ ] `Scene.tsx` has no randomness, no per-render geometry, no extra UI; every visible character has a `CastLight`.
- [ ] No file anywhere adds a button other than the one play button; no download/export/render code exists.
- [ ] Nothing imports `remotion`, `@remotion/*`, `fs`, `child_process`, or calls `fetch`.
