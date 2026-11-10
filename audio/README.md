# vbeat-audio

Synthesised sound effects for vbeat beats: a synth toolkit that AI agents call from small Python cue scripts,
a sandboxed runner that produces a sample-exact wav, audio checks, a preview image and an MP4 mux.
No recorded samples, no accounts, no network.

    pip install -e ".[test]"            # numpy, scipy, Pillow (+ pytest); ffmpeg and ffprobe on PATH
    python -m vbeat_audio selftest      # end to end in about 15 s
    python -m pytest                    # full suite (a few minutes)

    python -m vbeat_audio spec   --beat tests/fixtures/engine/stat_land.beat.json \
                                 --markers tests/fixtures/engine/stat_land.markers.json --out /tmp/spec.json
    python -m vbeat_audio render --spec /tmp/spec.json --cue sfx/examples/stat_land.py --out /tmp/sfx
    python -m vbeat_audio mux    --video beat.mp4 --wav /tmp/sfx/sfx.wav --out beat_sfx.mp4
    python -m vbeat_audio catalog --out demo     # then open demo/audition.html and listen

Without installing, use `PYTHONPATH=src`. Start reading at `docs/AUDIO_INTERFACES.md` (the frozen contracts),
then `sfx/sfx-style.md` and `sfx/SYNTH_API.md` (the two documents meant for AI system prompts) and
`docs/DECISIONS.md` (what was decided, and what could not be verified).
