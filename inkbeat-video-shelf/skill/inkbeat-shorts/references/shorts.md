# Shorts

## From scratch
1. **Facts and script.** A source list with only checked facts; a script of ~150–170 words for ~60–70 s (the narrator
   reads ~148–220 words/min depending on the voice speed). Shape: a concrete, strange hook in the first line;
   escalation in short sentences; one plain explanation; a twist; a last line that lands. Numbers written as words for
   the TTS.
2. **Voice-over** (audio-and-voice.md) → word timings.
3. **Plan** (`plan_src.py`, word-anchored): setups, beats, transitions, acts and their light, sound-off tags, SFX cues
   on exact words, the cast/sets/props list. Print the stats. STOP.
4. **Look-dev**: a cast lineup and one establishing frame per set in its act light, at 540×960. STOP.
5. **The Short**: build, render once at full resolution with motion blur, QA (render-and-qa.md). STOP for notes.

Design notes that worked:
- Few locations, many framings: change *sets* only at story turns (~every 8–12 beats) and re-frame inside a set every
  ~0.9 s.
- One anchor object per location (the thing the story is about), alternating macro on it and a medium on a character.
- A laugh or a reveal in two beats: in on the first word, out on the second (the room gets bigger).
- In-world graphics instead of overlays: a board, a sign, a calendar page, a label on a prop.
- An explanation may leave the story set entirely for a few seconds (a cutaway, a cross-section).
- Characters sit low in frame for punchlines; wides keep them in the lower third so the set fills the frame.

## Captions (burned in)
- 1–2 words per chunk (2 when both are short, ≤ 4–5 letters, and not across a sentence end), **lowercase as spoken**,
  punctuation kept, swapped instantly on each chunk's onset, shown **2 frames early**, held until the next onset.
- Font: a heavy geometric sans (ExtraBold/Black), **~86 px at 1080 wide** by default (compact so it stays crisp above the bottom third), a heavy dark stroke
  (paint-order stroke then fill), a soft drop shadow, centered horizontally at **70% of the frame height** (y ≈ 1344
  px at 1080×1920).
- **All words white.** An accent color is optional; if you use one, accent at most one key word per sentence, never
  every word.
- Hide captions after the last word.

## Sound-off readability
Viewers scroll muted; a plain render with clear tags can beat a beautifully lit one on this alone. Put the story in
the picture: 1–3 word tags on the key objects (a number on a wall, a label on a box, a name on a sign), bold, large,
high contrast, unlit. QA: read the 2 fps contact sheet with no sound; if the story doesn't read, add tags.

**Tag discipline:**
- Tags carry only the story's key facts, taken from the checked sources: about one primary tag per ~15 s (a year, a
  number, a short label). Other lettering only repeats names or words the voice says.
- Never a sign on every object; drop a tag when color or costume already says it.
- Never over a face; always whole inside the frame; never hidden (underwater, behind a prop).
- **Keep big lettering out of fast move paths:** a lettered board sweeping through an orbit or dolly flickers. Move
  the board or slow the move.

## All on-screen text
- Stays inside the frame and disappears when its moment ends: no text running off screen, no leftover word on a prop.
- Is in the video's language (translate notes, labels and props the source gave in another language), with no label
  saying it was translated.

## Shorts cut from a long-form film
- **Spec:** a Short is a list of VO line numbers in play order; a script turns it into film-time segments.
- **Picture:** a vertical composition re-renders each segment's own 3D frames at 1080×1920 (the same scene code, a
  vertical camera): re-aim at the shot's focus with vertical fov ×1.4; tilt the subject up to ~37% so faces sit above
  the captions; center low objects lower and wider; aim table-height people framings 0.4 m higher.
- **Motion:** a 12% push across every hold plus a 5-frame snap punch-in on every cut (the long form's calm grammar is
  too static for a Short).
- **Hook → twist:** open on the strongest line, end on the punchline; lines may be reordered.
- **Ending:** hold the last frame with the VO silent and the music fading; extending the last segment leaks the film's
  next line and shot.
- **Audio:** cut the VO and SFX stems by butting segments with 10 ms edge fades. **Never overlap-crossfade**: it
  shortens the audio 20 ms per join and the captions drift late. Keep the music bed continuous (an unducked stem),
  duck it under the new VO, two-pass loudnorm −14 LUFS.
- **Captions** lead the voice by 2 frames, clamped to the segment end; measure word times with a local forced aligner
  (they land within a few ms of the speech onsets).
- **Reusing staging:** call the film's actors with the Short's time mapped onto the film moment of the same action
  (`filmTime = filmAnchor + (t − shortAnchor)`), so acting and set animations land on the Short's words. A piecewise
  map works for counted beats; keep the slope near 1 for close-ups (a steep map makes small fast motion strobe).

## Captions by format (video-shelf pipeline)
- **9:16 Shorts (`--caps word`, default):** the rules above: 1-2 lowercase words, swapped on word onsets, big, centred at 70% height.
- **16:9 YouTube (`--caps sentence`, default for landscape):** the whole sentence is on screen in white with the original capitalisation; only the word being
  spoken is lit in the accent colour (`--accent`, default `#ffd23f`). Small (about 4.6% of the frame height), bottom centre (about 91% height), at most 2 lines
  (it shrinks a little for a long sentence). A sentence appears 2 frames before its first word and stays 0.4 s after its last word; the lit word changes on
  each onset, with no pop or scale. Sentences end at `. ! ?` (not `Dr.` or `e.g.`), at a pause over 0.8 s, or at 14 words / 84 characters (at a comma if there is one).
- `--capscale 1.2` makes either style 20% bigger; `--caps 0` turns captions off.

