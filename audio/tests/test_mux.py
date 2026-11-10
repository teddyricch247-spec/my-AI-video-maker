import subprocess

import numpy as np
import pytest

import helpers
from vbeat_audio import mux as M
from vbeat_audio.constants import SR

EX = helpers.ROOT / "sfx" / "examples"


def make_video(path, fps=30, frames=150):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=320x240:rate={fps}",
                        "-frames:v", str(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return path


def video_md5(path):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"], capture_output=True, text=True)
    return r.stdout.strip()


def make_wav(tmp_path, name="stat_land"):
    env = helpers.render_file(EX / f"{name}.py", name, tmp_path / "r")
    return env["artifacts"]["wav"]


@pytest.mark.parametrize("codec,ext", [("aac", "mp4"), ("pcm_mov", "mov")])
def test_mux_verifies_with_ffprobe(codec, ext, tmp_path):
    video = make_video(tmp_path / "in.mp4")
    wav = make_wav(tmp_path)
    out = tmp_path / f"out.{ext}"
    summary = M.mux(video, wav, out, codec)
    a, b = M.probe(video), M.probe(out)
    assert len(b["video"]) == 1 and len(b["audio"]) == 1
    assert b["video"][0]["codec"] == a["video"][0]["codec"] == "h264"
    assert b["video"][0]["packets"] == a["video"][0]["packets"] == 150  # same frame count
    assert video_md5(out) == video_md5(video)  # picture copied, not re-encoded
    au = b["audio"][0]
    assert au["sample_rate"] == SR and au["channels"] == 2 and au["codec"] == ("aac" if codec == "aac" else "pcm_s16le")
    tol = 0.025 if codec == "aac" else 1 / SR + 1e-6
    assert abs(au["duration"] - b["video"][0]["duration"]) <= tol and abs(summary["av_diff_s"]) <= tol
    assert not list(tmp_path.glob(".*partial*"))


def test_stereo_is_a_unity_gain_duplicate_of_mono(tmp_path):
    video = make_video(tmp_path / "in.mp4")
    wav = make_wav(tmp_path)
    out = tmp_path / "out.mov"
    M.mux(video, wav, out, "pcm_mov")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-f", "s16le", "-c:a", "pcm_s16le", str(tmp_path / "o.raw")], check=True)
    st = np.fromfile(tmp_path / "o.raw", "<i2").reshape(-1, 2)
    mono = helpers.read_wav(wav)[4]
    assert st.shape[0] == len(mono) and np.array_equal(st[:, 0], mono) and np.array_equal(st[:, 1], mono)


def test_truncated_wav_makes_mux_fail_and_leaves_nothing(tmp_path):
    video = make_video(tmp_path / "in.mp4")
    wav = make_wav(tmp_path)
    n, _, _, _, pcm = helpers.read_wav(wav)
    import wave
    short = tmp_path / "short.wav"
    with wave.open(str(short), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm[: n // 2].astype("<i2").tobytes())
    for codec, ext in (("aac", "mp4"), ("pcm_mov", "mov")):
        out = tmp_path / f"short.{ext}"
        with pytest.raises(M.MuxError, match="audio is"):
            M.mux(video, short, out, codec)
        assert not out.exists() and not list(tmp_path.glob(".*partial*"))


def test_api_envelope_for_mux_failure_and_bad_arguments(tmp_path):
    from vbeat_audio import api
    video = make_video(tmp_path / "in.mp4")
    env = api.mux(video, tmp_path / "missing.wav", tmp_path / "o.mp4")
    assert env["ok"] is False and env["error"]["type"] == "MuxError" and env["command"] == "mux"
    wav = make_wav(tmp_path)
    assert api.mux(video, wav, tmp_path / "o.mov", "aac")["ok"] is False  # wrong extension for the codec
    assert api.mux(video, wav, tmp_path / "o.mp4", "mp3")["ok"] is False
    good = api.mux(video, wav, tmp_path / "o.mp4")
    assert good["ok"] and good["report"]["ok"] and good["artifacts"]["video"].endswith("o.mp4")


def test_other_frame_rates_and_wrong_wav_format(tmp_path):
    video = make_video(tmp_path / "in24.mp4", fps=24, frames=96)
    env = helpers.render_file(EX / "title_stamp.py", "title_stamp", tmp_path / "r")  # 4 s at 24 fps
    M.mux(video, env["artifacts"]["wav"], tmp_path / "o.mp4")
    stereo = tmp_path / "st.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", env["artifacts"]["wav"], "-ac", "2", str(stereo)], check=True)
    with pytest.raises(M.MuxError, match="mono"):
        M.mux(video, stereo, tmp_path / "o2.mp4")
