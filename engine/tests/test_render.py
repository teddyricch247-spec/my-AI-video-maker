import pytest
from helpers import SCENES, good_scene, png_bytes, write_spec
from vbeat_sprite import render
from vbeat_sprite.browser import BrowserSession, RenderTimeout, SceneFailure
from vbeat_sprite.spec import SpecError, load_spec, parse_spec

TOMATO = (0xE4, 0x45, 0x2F)


def _spec(tmp_path, scene=None, **kw):
    return load_spec(write_spec(tmp_path, scene or good_scene(), **kw))


def _size(path):
    from PIL import Image
    with Image.open(path) as im:
        return im.size, im.format


def test_strip_dimensions_and_layout(tmp_path):
    spec = _spec(tmp_path)
    r = render.strip(spec, None, tmp_path / "o", png=True)
    assert len(r["times"]) == 4 and r["times"][-1] == (spec.frames - 1) / spec.fps
    assert _size(r["artifacts"]["strip"]) == ((1280, 720), "JPEG")       # 2x2 tiles of 640x360
    assert _size(r["artifacts"]["strip_png"]) == ((1280, 720), "PNG")
    five = render.strip(spec, [0.2, 0.8, 1.5, 2.5, 4.0], tmp_path / "o5")
    assert _size(five["artifacts"]["strip"])[0] == (1920, 720)           # 3x2 tiles
    six = render.strip(spec, [0, 1, 2, 3, 4, 5], tmp_path / "o6")
    assert _size(six["artifacts"]["strip"])[0] == (1920, 720)
    with pytest.raises(ValueError, match="1..6"):
        render.strip(spec, [0, 1, 2, 3, 4, 5, 5.5], tmp_path / "o7")
    with pytest.raises(ValueError, match="outside this beat"):
        render.strip(spec, [0, 99], tmp_path / "o8")


def test_strip_jpeg_quality_85(tmp_path):
    from PIL import Image
    r = render.strip(_spec(tmp_path), None, tmp_path / "o")
    with Image.open(r["artifacts"]["strip"]) as im:
        q = im.quantization[0]
        # libjpeg luminance table scaled for quality 85: first coefficient 16*(200-170)/100 = 5 (+-1)
        assert abs(q[0] - 5) <= 1


def test_default_strip_times():
    spec = parse_spec({"project": {"fps": 30, "width": 1280, "height": 720}, "beat": {"idx": 0, "f0": 0, "f1": 180},
                       "scene": "s.js", "assets_dir": "a"})
    assert render.default_strip_times(spec) == [12 / 30, 45 / 30, 108 / 30, 179 / 30]
    short = parse_spec({"project": {"fps": 30, "width": 1280, "height": 720}, "beat": {"idx": 0, "f0": 0, "f1": 9},
                        "scene": "s.js", "assets_dir": "a"})
    ts = render.default_strip_times(short)
    assert ts == sorted(set(ts)) and ts[-1] == 8 / 30 and len(ts) >= 2


def test_frames_sizes_and_formats(tmp_path):
    spec = _spec(tmp_path)
    r = render.frames(spec, [0, 1.5, 3.0], tmp_path / "f")
    assert sorted(r["artifacts"]) == ["frame_f0000", "frame_f0045", "frame_f0090"]
    assert all(_size(p) == ((1280, 720), "JPEG") for p in r["artifacts"].values())
    small = render.frames(spec, [1.5], tmp_path / "f2", size="960x540", fmt="png")
    assert _size(small["artifacts"]["frame_f0045"]) == ((960, 540), "PNG")
    for bad in ("1000x600", "1920x1080", "640x360x1"):
        with pytest.raises((ValueError, SpecError)):
            render.frames(spec, [1.0], tmp_path / "f3", size=bad)


def test_markers(tmp_path):
    assert render.markers(_spec(tmp_path)) == [{"id": "m1", "t": 1.0, "kind": "pop"}]


def test_word_anchor_box_appears_at_expected_frame_within_one_frame(tmp_path):
    from PIL import Image
    spec = _spec(tmp_path)
    anchor = next(w for w in spec.words if w.id == "w0003")
    expected = anchor.f0 - spec.beat.f0                           # frame 30 of the beat
    fps_times = [(n / spec.fps) for n in range(expected - 3, expected + 4)]
    r = render.frames(spec, fps_times, tmp_path / "f", fmt="png")
    first = None
    for n in range(expected - 3, expected + 4):
        with Image.open(r["artifacts"][f"frame_f{n:04d}"]) as im:
            rgb = im.convert("RGB")
            hits = sum(1 for x, y in ((300, 340), (210, 340), (250, 300), (400, 400))      # inside the box once grown
                       if all(abs(a - b) <= 6 for a, b in zip(rgb.getpixel((x, y)), TOMATO)))
        if hits and first is None:
            first = n
    assert first is not None and 0 <= first - expected <= 1, (first, expected)
    assert first > expected - 1                                    # never early


def test_renders_are_deterministic(tmp_path):
    spec = _spec(tmp_path)
    a = render.frames(spec, [0.4, 1.7, 5.0], tmp_path / "a", fmt="png")
    b = render.frames(spec, [0.4, 1.7, 5.0], tmp_path / "b", fmt="png")
    for k in a["artifacts"]:
        assert open(a["artifacts"][k], "rb").read() == open(b["artifacts"][k], "rb").read(), k


def test_scene_error_is_reported_with_time(tmp_path):
    spec = _spec(tmp_path, SCENES / "c3_throw.js")
    with pytest.raises(SceneFailure) as ei:
        render.frames(spec, [2.0], tmp_path / "f")
    assert ei.value.t == 2.0 and "boom" in ei.value.message


def test_hang_is_killed_by_watchdog(tmp_path):
    spec = _spec(tmp_path, SCENES / "hang.js")
    with pytest.raises(RenderTimeout, match="infinite loop"):
        with BrowserSession(spec, call_timeout=3) as s:
            page = s.new_page()
            page.init()
            page.ok("drawAt", 1.0)


def test_media_is_served_and_usable(tmp_path):
    from PIL import Image
    (tmp_path / "pic.png").write_bytes(png_bytes(8, 8, (0, 128, 0)))
    spec = _spec(tmp_path, media={"img1": "pic.png"}, params={"useMedia": True})
    r = render.frames(spec, [1.0], tmp_path / "f", fmt="png")
    with Image.open(r["artifacts"]["frame_f0030"]) as im:
        assert im.convert("RGB").getpixel((670, 190)) == (0, 128, 0)


def test_spec_validation_lists_every_problem(tmp_path):
    with pytest.raises(SpecError) as ei:
        parse_spec({"project": {"fps": 29, "width": 1920, "height": 1200}, "beat": {"idx": 1, "f0": 10, "f1": 10},
                    "words": [{"id": "a"}], "scene": "", "assets_dir": "x", "media": {"bad id": "x"}})
    msg = str(ei.value)
    for needle in ("project.fps", "project.width/height", "beat:", "words[0]", "scene", "media."):
        assert needle in msg, needle


# ------------------------------------------------------------------ video
def _video(tmp_path, scene=None, name="o.mp4", **kw):
    from vbeat_sprite import ffmpeg
    size = kw.pop("size", None)
    spec = _spec(tmp_path, scene, **kw)
    return spec, render.video(spec, tmp_path / name, size=size), ffmpeg


def test_video_is_verified_by_ffprobe(tmp_path):
    spec, r, ffmpeg = _video(tmp_path, frames=45)
    v = r["verification"]
    assert (v["codec"], v["pix_fmt"], v["width"], v["height"], v["frames"], v["fps"]) == ("h264", "yuv420p", 1280, 720, 45, 30)
    info = ffmpeg.probe(tmp_path / "o.mp4")
    assert len(info["streams"]) == 1                                   # silent: no second stream
    s = info["streams"][0]
    assert (s["color_space"], s["color_transfer"], s["color_primaries"]) == ("bt709", "bt709", "bt709")
    assert int(s["nb_read_frames"]) == spec.beat.f1 - spec.beat.f0     # frame count == f1 - f0 exactly


@pytest.mark.parametrize("fps", [24, 25, 60])
def test_video_frame_count_and_fps_for_other_rates(fps, tmp_path):
    spec, r, _ = _video(tmp_path, SCENES / "flat_paper.js", fps=fps, frames=fps // 2 + 7)
    assert r["verification"]["frames"] == fps // 2 + 7 and r["verification"]["fps"] == fps


def test_video_export_size_1080p(tmp_path):
    _, r, ffmpeg = _video(tmp_path, SCENES / "flat_paper.js", width=1920, height=1080, frames=8)
    assert (r["verification"]["width"], r["verification"]["height"]) == (1920, 1080)
    _, r2, _ = _video(tmp_path, SCENES / "flat_paper.js", frames=8, size="1280x720", name="o2.mp4", width=1920, height=1080)
    assert (r2["verification"]["width"], r2["verification"]["height"]) == (1280, 720)   # size override


def test_keyframe_every_second(tmp_path):
    _, _, ffmpeg = _video(tmp_path, frames=75)
    assert ffmpeg.keyframe_indices(tmp_path / "o.mp4") == [0, 30, 60]


def test_flat_paper_colour_survives_encode_within_3(tmp_path):
    _, _, ffmpeg = _video(tmp_path, SCENES / "flat_paper.js", frames=12)
    w, h, raw = ffmpeg.decode_frame_rgb(tmp_path / "o.mp4", 5)
    assert len(raw) == w * h * 3
    paper = (0xF3, 0xEA, 0xD7)
    for ch in range(3):
        values = raw[ch::3]
        assert abs(min(values) - paper[ch]) <= 3 and abs(max(values) - paper[ch]) <= 3, (ch, min(values), max(values))


def test_two_renders_have_identical_frame_hashes(tmp_path):
    _, _, ffmpeg = _video(tmp_path, frames=48, name="a.mp4")
    _video(tmp_path, frames=48, name="b.mp4")
    a, b = ffmpeg.frame_md5s(tmp_path / "a.mp4"), ffmpeg.frame_md5s(tmp_path / "b.mp4")
    assert len(a) == 48 and a == b
    assert len(set(a)) > 10                                          # the scene really moves


def test_failed_verification_fails_the_command(tmp_path):
    from vbeat_sprite import ffmpeg
    _, _, _ = _video(tmp_path, SCENES / "flat_paper.js", frames=10)
    with pytest.raises(ffmpeg.VerificationError, match="frames: expected 11, got 10"):
        ffmpeg.verify(tmp_path / "o.mp4", width=1280, height=720, frames=11, fps=30)
    with pytest.raises(ffmpeg.VerificationError, match="fps: expected 25"):
        ffmpeg.verify(tmp_path / "o.mp4", width=1280, height=720, frames=10, fps=25)
    with pytest.raises(ffmpeg.VerificationError, match="width: expected 1920"):
        ffmpeg.verify(tmp_path / "o.mp4", width=1920, height=720, frames=10, fps=30)


def test_scene_error_during_video_leaves_no_file(tmp_path):
    spec = _spec(tmp_path, SCENES / "c3_throw.js", frames=60)
    with pytest.raises(SceneFailure):
        render.video(spec, tmp_path / "broken.mp4")
    assert not (tmp_path / "broken.mp4").exists()


def test_bench_reports_numbers(tmp_path):
    b = render.bench(work_dir=tmp_path, frames=12, size=(1280, 720))
    assert set(b["ms_per_frame"]) == {"draw", "capture", "encode"}
    assert all(v > 0 for v in b["ms_per_frame"].values()) and b["total_fps"]["pipelined"] > 0


def test_time_snapping_rounds_half_up_like_the_time_model(tmp_path):
    spec = _spec(tmp_path)
    assert render.snap_times(spec, [0.5 / 30, 1.5 / 30, 2.5 / 30]) == [1 / 30, 2 / 30, 3 / 30]
    assert render.snap_times(spec, [0.49 / 30]) == [0.0]


def test_blank_free_defaults_never_leave_the_beat(tmp_path):
    spec = _spec(tmp_path, frames=60)
    assert all(0 <= t <= (spec.frames - 1) / spec.fps for t in render.default_strip_times(spec))
