"""Requirement 2: transcript + scene file -> finished MP4 with sound effects baked in, each stage verified.
Uses the REAL asset library (examples/beats/big_number uses tech/big-stat)."""
import json
import subprocess
import wave
from pathlib import Path

import pytest

import helpers
from helpers import CUE, SCENE, TMP, cli, example_beat, render_beat

from vbeat_shared.envelope import classify, validate_check_report, validate_envelope, Outcome
from vbeat_pipeline.run import STAGES

pytestmark = pytest.mark.render


def test_the_documented_pipeline_produces_a_verified_mp4_with_sound():
    beat = example_beat()
    p = json.loads((beat / "pipeline.json").read_text())
    assert p["ok"] and p["failed_stage"] is None and p["stage_order"] == list(STAGES)
    assert all(s["ok"] for s in p["stages"].values())
    for name in ("check", "sfx_render"):
        assert validate_check_report(p["stages"][name]["report"]) == []
        assert p["stages"][name]["report"]["counts"]["error"] == 0
    spec = json.loads((beat / "spec.json").read_text())
    final = beat / "final.mp4"
    assert final.stat().st_size > 10_000
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(final)], capture_output=True, text=True).stdout)
    kinds = sorted(s["codec_type"] for s in probe["streams"])
    assert kinds == ["audio", "video"]
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert int(v["nb_frames"]) == spec["beat"]["f1"] - spec["beat"]["f0"] == 121
    # the scene used the real library, not a stub
    assert "tech/big-stat" in (beat / "scene.js").read_text() and "stub/" not in (beat / "scene.js").read_text()
    assert json.loads((beat / "spec.json").read_text())["assets_dir"].endswith("motion-assets/assets")


def test_the_thunk_in_the_final_file_lands_on_the_real_markers_frame():
    import numpy as np
    beat = example_beat()
    markers = json.loads((beat / "markers.json").read_text())
    markers = markers["markers"] if isinstance(markers, dict) else markers
    done = next(m for m in markers if m["id"] == "done")
    assert done["kind"] == "thud"
    wav = TMP / "final_audio.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(beat / "final.mp4"), "-vn", "-ac", "1", "-ar", "48000", str(wav)], check=True)
    with wave.open(str(wav)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float)
    env = np.abs(x)
    win = int(0.01 * sr)
    smooth = np.convolve(env, np.ones(win) / win, mode="same")
    near = slice(int((done["t"] - 0.3) * sr), int((done["t"] + 0.3) * sr))
    peak_t = (near.start + int(np.argmax(smooth[near]))) / sr
    assert abs(peak_t - done["t"]) < 0.06, (peak_t, done["t"])     # AAC adds a few ms; the frame is 33 ms


def test_a_broken_scene_stops_the_pipeline_at_the_first_failing_stage(tmp_path):
    bad = tmp_path / "scene.js"
    bad.write_text("export const meta = {title: 'bad'};\nexport function draw(rt, t) { rt.lib.draw('tech/does-not-exist', t, {}); }\nexport function markers(rt) { return []; }\n")
    rc, env = render_beat(tmp_path / "out", words=(0, 2), scene=bad)
    assert rc in (1, 2) and not validate_envelope(env)
    p = json.loads((tmp_path / "out" / "pipeline.json").read_text())
    assert not p["ok"] and p["failed_stage"] in ("strip", "check")
    assert "video" not in p["stages"] and "mux" not in p["stages"] and not (tmp_path / "out" / "final.mp4").exists()
    assert "tech/does-not-exist" in p["failure"]


SHORT_SCENE = ("export const meta = { title: 'short' };\n"
               "export function draw(rt, t) { rt.lib.draw('tech/title-card', t, { kicker: 'SHORT', lines: ['Three', 'words.'] }); }\n"
               "export function markers(rt) { return rt.lib.markers('tech/title-card', {}).filter(m => m.t <= rt.dur); }\n")


def test_a_broken_cue_script_stops_before_mux_and_leaves_no_final_file(tmp_path):
    bad = tmp_path / "cue.py"
    bad.write_text("from synth import *\n\ndef render(ctx):\n    raise ValueError('boom')\n")
    scene = tmp_path / "scene.js"
    scene.write_text(SHORT_SCENE)
    rc, env = render_beat(tmp_path / "out", words=(0, 2), scene=scene, cue=bad)
    assert rc == 1 and not validate_envelope(env)
    p = json.loads((tmp_path / "out" / "pipeline.json").read_text())
    assert p["failed_stage"] == "sfx_render" and p["stages"]["sfx_render"]["outcome"] == Outcome.REPORT_FAILED.value
    assert "mux" not in p["stages"] and not (tmp_path / "out" / "final.mp4").exists()


def test_a_silent_beat_is_verified_as_silent(tmp_path):
    scene = tmp_path / "scene.js"
    scene.write_text(SHORT_SCENE)
    rc, env = render_beat(tmp_path / "out", words=(0, 2), scene=scene, cue=None)
    assert rc == 0, env
    p = json.loads((tmp_path / "out" / "pipeline.json").read_text())
    assert p["stage_order"] == ["ingest", "spec", "strip", "check", "markers", "video", "verify"] and p["stages"]["verify"]["report"]["audio"] is False
