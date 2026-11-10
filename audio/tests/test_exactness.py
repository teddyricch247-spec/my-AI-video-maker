import hashlib

import helpers
from vbeat_audio.constants import ALLOWED_FPS, SR, samples_for
from vbeat_audio.ctx import Ctx
from vbeat_audio.spec import build_spec
import pytest


@pytest.mark.parametrize("fps", list(ALLOWED_FPS))
def test_samples_exact_for_every_fps(fps):
    assert SR % fps == 0
    for frames in (1, 7, 90, 150, 301):
        assert samples_for(frames, fps) == frames * SR // fps
        assert samples_for(frames, fps) * fps == frames * SR  # no rounding at all
        spec = build_spec({"project": {"fps": fps}, "beat": {"f0": 100, "f1": 100 + frames}, "words": []}, [])
        assert spec["samples"] == frames * SR // fps
        assert Ctx(spec).samples == spec["samples"]


def test_bad_fps_rejected():
    with pytest.raises(Exception):
        build_spec({"project": {"fps": 29}, "beat": {"f0": 0, "f1": 10}, "words": []}, [])


def test_word_times_are_beat_local_and_clamped():
    beat = {"project": {"fps": 30}, "beat": {"idx": 3, "f0": 300, "f1": 450},
            "words": [{"id": "w1", "text": "a", "start_ms": 10000, "end_ms": 10180, "f0": 300, "f1": 305},
                      {"id": "w2", "text": "b", "f0": 290, "f1": 500}]}
    s = build_spec(beat, [{"id": "land", "t": 1.2, "kind": "thud"}, {"id": "late", "t": 9.0, "kind": "pop"}])
    assert s["words"][0] == {"id": "w1", "start": 0.0, "end": round(5 / 30, 6)}
    assert s["words"][1] == {"id": "w2", "start": 0.0, "end": 5.0}
    assert s["markers"][-1]["t"] == 5.0  # clamped, not an error


def test_wav_header_frame_count_and_byte_identical_runs(tmp_path):
    spec = helpers.spec("minimal")
    outs = []
    for i in range(2):
        env = helpers.render_file(helpers.ROOT / "sfx" / "examples" / "minimal.py", "minimal", tmp_path / f"r{i}")
        assert env["ok"] and env["report"]["ok"]
        n, ch, width, rate, pcm = helpers.read_wav(env["artifacts"]["wav"])
        assert (n, ch, width, rate) == (spec["samples"], 1, 2, SR)
        outs.append(hashlib.sha256(open(env["artifacts"]["wav"], "rb").read()).hexdigest())
    assert outs[0] == outs[1]


def test_peak_equals_peak_dbfs(tmp_path):
    import numpy as np
    env = helpers.render_file(helpers.ROOT / "sfx" / "examples" / "stat_land.py", "stat_land", tmp_path)
    pcm = helpers.read_wav(env["artifacts"]["wav"])[4]
    assert abs(20 * np.log10(np.abs(pcm).max() / 32767.0) - (-6.0)) < 0.01
    assert pcm[0] == 0 and abs(int(pcm[-1])) <= 1  # 5 ms fades
