# Production

## Structure
- **A contract file** at the root of each video's folder: canon and inputs, the toolkit and what is read-only, style
  targets, code layout and ownership, core interfaces, proof and logs, and binding decisions as they're made.
- **One owner per area** (a suggested layout for a multi-video project; the starter keeps everything in `src/`):
  `core/` (registry, compositions, rig, moods, shared FX), `sets/<SET>/` (World component, anchors, camera presets,
  variant flags), `seq/` (per-sequence shots, clock, actors, overlays), `cast/`, `ui/`, `audio/`.
- An auto-loader (bundler `require.context`) registers sequences and sets: one syntax error in any of them breaks the
  bundle for everyone, so run a typecheck gate (`tsc --noEmit`, filtered to your folder) before every bundle.
- Give each video its own entry (`index.ts` + `Root.tsx`) and its own bundle dir: never edit the project's shared
  Root.
- Composition ids may contain only letters, digits and `-` (no underscores).

## Workflow
1. Read the brief and the style study; write the plan generator; print the stats. **STOP.**
2. Look-dev stills (cast lineup, one frame per set in its light). **STOP.**
3. A pilot (the first ~80 s of a film, or a Short's first ~15 s with VO, music, SFX and captions). **STOP.**
4. Roll out; after each part render stills at major cues and a half-scale preview; QA; continue.
5. Final render, QA, deliver with paths and an honest list of what remains.

At every stop: file paths plus an honest list of what remains or doesn't work.

- **If asked to work autonomously** ("continue without asking", "don't stop"), don't stop for the gates: work to the
  end, decide yourself, and report what you decided at the end.
- **Self-critique loop:** after each version, name its 2–3 biggest weaknesses, fix them biggest first, re-measure, and
  keep a change only if both the numbers and the eye check improve.
- **Confirm a defect still exists before fixing it:** re-render that beat from the current code first; review lists go
  stale.
- For a target look, give Claude 5-10 frames from videos you like, for private analysis only: measure light, color and
  pacing, but don't copy their characters, designs, sets or other distinctive elements. Keep the frames outside the
  project and its git repo, and never ship or publish them. (How to measure: look-and-ink.md.)
- **No extra installs, no git** inside the video work: no new npm or pip packages and no commits unless the user asks.
  The starter's own `npm install` is the exception.

## Privacy in anything published
Nothing from the maker's computer or identity may appear in picture, voice or captions: real folder paths and names,
the OS user name, email addresses, other project names, dates, and anything else that identifies the maker. Scrub at
asset prep (screenshots, props, tags), then audit the final frames (a contact sheet plus 100% crops of any text)
before delivery.

## No real brands
No real brands or logos on props and screens (see sets-and-materials.md).

## Shared code
- Shared sets change only **additively**: a new variant flag that defaults to the old behavior; re-read before every
  edit.
- Recurring "signature" frames (a recurring transition or title) are fixed once audio is cued: pixel-identical every
  time.
- Reusing another piece's world: import it read-only, never copy-edit its files; build new sets and cast when the
  brief asks for a new world.

## Sub-agents and budget
- Many agents in parallel can burn a whole usage window in well under an hour. Default to **no sub-agents**; use 2–3
  at most when a job truly needs them. Keep 1–2 audit rounds, contact sheets rather than single frames, **at most 3
  images per step**, list folders before opening single files, and never re-render unchanged frames.
- Brief each agent like a peer: the rules file, its own files, its own bundle dir, concurrency ≤ 3, one render at a
  time, proof paths and an honest "remaining" list.
- Direction first: a pilot with ~3 agents (look, two areas), shown to the user, then roll out.
- When a render-state bug is suspected, send a read-only code investigator (no renders) while the GPU is busy.
- Review agents' work yourself at full resolution before delivering.
