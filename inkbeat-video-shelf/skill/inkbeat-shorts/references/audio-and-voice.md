> **Video-shelf workflow: NO voice-over and NO music are ever made.** The owner records the voice in their own editor and supplies a transcript with a timestamp on every word.
> Skip the "Voice-over" and "Music" sections below (no TTS, no voices, **NEVER add music**). When audio is requested, deliver **sound effects (SFX) only** via `--audio` (no voice, no music bed). Keep SFX peaks modest relative to a voice added later.

# Audio and voice-over

## Voice-over (any TTS service)
- **Script file:** one `SPEAKER: text` per line, roles in capitals (letters and underscores). Write numbers as words
  ("one point five", "ten thousand"). Never change the script text silently; ask.
- **Voices:** one narrator voice per series, chosen once and kept. Shorts read faster (speed ~1.1–1.15) than long form
  (~1.0–1.05). Never clone a real person's voice. In one scene, voices must be clearly distinct.
- **Cost control:** check the quota and the cost of a full build first; samples only (~60 characters per role) until
  the user approves; then build.
- **Build once, cache per turn:** each line is its own file; a retake deletes only that turn's file and rebuilds, so
  the rest costs nothing. Join the turns, keep the **premaster** for the edit, master a copy to −14 LUFS.
- **Pronunciation:** names and product words get misread. Respell them in a per-turn pronunciation override, keep the
  script text, map the word timings back to the script spelling, and verify with a local speech-to-text pass. Check
  numbers, acronyms and units the same way.
- **Tail artifacts:** some models add a cut-off burst at a turn's end; detect and trim it in the build.
- **Timings:** if word onsets look late, re-align them to the silences before planning.
- **Secrets:** API keys live in an env file the user manages. Never open, print or copy it in a way that shows its
  content, and never ask for a key in chat.
- Keep TTS keys outside the Remotion project folder (not in its `.env`): Remotion loads that file into the render
  browser.

## Music — NEVER ADD MUSIC
- **Do NOT add music.** When the user asks for audio/sound in the video-shelf workflow, they mean **sound effects (SFX) only** — never generate or mix a background music bed, melodic loop, or soundtrack.

## SFX
- Story SFX only, on the exact word (6–8 per 20 s): a door, a pop, an impact, a click on a number, a thud, ticking. No
  whoosh on every move (popular 3D cartoon Shorts show no systematic hit on camera beats).
- **Level each cue against the voice**, not with one global gain: one-shots peak ~8 dB under the voice peak (a big
  crowd or blast ~6 dB), and cap each cue so its loudest 100 ms window is ≥ 6 dB under the speech RMS; beds (rain,
  crickets, wind) ~20 dB under the speech RMS. A sustained tone normalized by peak (a long drone or hum) is far louder
  than a click.
- Synthesized SFX are fine (deterministic seeds, short fades at both ends, 48 kHz); library stems work for ambience.
- Verify objectively when nobody can listen: the loudest 100 ms windows outside speech, the SFX contribution at each
  cue.

## Master
Two-pass `loudnorm` to **−14 LUFS integrated, −1 dBTP**, LRA ≤ 7. The picture ends ~0.7 s after the last word.
