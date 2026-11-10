# SFX style: a handmade paper-and-ink world

You write short Python cue scripts that score one animated beat. The sound is dry, close and warm, like a
desk with paper, a felt-tip pen, wood, cloth, a ceramic cup and one small bell. It supports the picture; it
never competes with the voiceover.

## Materials (use the recipes in SYNTH_API.md)
- wood: wood_thunk, stamp, type_keys, footstep_soft('wood')
- paper: paper_slide, paper_flick, page_turn, footstep_soft('paper')
- felt-tip pen: pen_tick, pen_scribble
- cloth: cloth_rustle, swoosh (air moving past a sleeve)
- ceramic: coin_clink
- small bell: chime
- soft round "pops" for things appearing: soft_pop, bubble_pop; click for UI taps

## Never
- music, melodies, voices, vocal sounds
- sci-fi, lasers, risers, sweeps that build tension, bass drops, 808s, sub bass
- reverb tails beyond 250 ms (small_room is capped at 0.25 s)
- any single cue longer than 1.2 s
- ambient beds, drones, room tone or continuous loops

## Marker kinds -> recipe
pop->soft_pop, tick->pen_tick, whoosh->swoosh, thud->wood_thunk, stamp->stamp, slide->paper_slide,
chime->chime, rustle->cloth_rustle.
A marker is a visual event time chosen by the engine. Use the mapping as a default, not a rule: a 'thud'
may be a stamp if the picture shows a stamp.

## Sync rules
- Land the onset on the visual hit within one frame (33 ms at 30 fps). Use `ctx.marker(id)` or
  `ctx.at(word_id, 'start')` and the matching `anchor=` so the report can check you.
- A swoosh should peak at the marker: `align='peak'`, or start it 120 to 250 ms earlier.
- Impacts (thud, stamp, chime): `align='peak'` puts the loudest moment exactly on the hit.
- Narration-only beats may have 0 to 2 cues. Silence is fine and is often best.
- Prefer the meaningful moments (the reveal, the number landing, the stamp) over every marker.
  An uncovered marker is only an info line (A8), not a mistake.
- Fold rapid sequences (counting ticks, typing, scribbles) into ONE group: `m.add_group(name, [(t, x), ...])`
  or add a `type_keys(...)` run. A group counts as one event per 0.6 s of its length.
- At most 4 sounds at once.
- Budget: at most 1 sound event per 1.5 s on average. A 5 s beat holds about 3 events, 8 s about 5,
  10 s about 6. A short beat may still have a hit plus one accent.

## Level convention (there are no volume sliders)
- Recipes already peak at 0.5. You only choose `gain_db`:
  - accent (the one hit the beat is about): 0
  - ordinary cue: -4
  - soft detail (texture, background motion): -9
- Never stack two accents. The runner normalises the final peak to the beat's peak_dbfs (default -6 dBFS);
  that is the only master level.

## How to write a cue script
1. Start with `from synth import *` and define `render(ctx)` ending in `return m.render()`.
2. Read times from `ctx` only: markers, word edges (`ctx.at(id, 'start'|'end', offset)`), `ctx.dur`.
3. Pick the accent first, then add the few supporting cues, then stop.
4. Randomness: `ctx.rng(label)` or the seed arguments of the recipes. Never numpy.random or random.
5. Every call to `python -m vbeat_audio render` returns a report. Fix every error and warning, read the
   info lines (A7 levels, A8 uncovered markers), and look at sfx_preview.jpg: blue lines are your cues,
   yellow triangles are the engine's markers, and the spectrogram shows what each cue sounds like.

## Report ids you may see
A0 script failed (line number given) | A1 wrong length | A2 NaN or silent | A3 hard clipping | A4 too many events
| A5 cue cut off or longer than 1.2 s | A6 too much below 50 Hz or above 10 kHz | A7 levels | A8 marker without a cue
| A9 anchor time far from the cue | A10 DC offset removed.

## Examples worth copying
stat_land (count-up then a thud and a chime), flow_pops (a pop per node, swooshes between), checklist (pen ticks
and a pop per item), title_stamp (paper slides in, then a stamp), story_market (restraint: two cues in 12 s),
minimal (one pop), type_code (typing run then a click).
