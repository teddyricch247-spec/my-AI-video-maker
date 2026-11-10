from vbeat_shared import timeline as tl
from vbeat_shared.ingest import parse_transcript
import pytest
from helpers import TRANSCRIPTS


def test_ms_to_frame_rounds_half_up():
    assert tl.ms_to_frame(0, 30) == 0
    assert tl.ms_to_frame(500, 30) == 15
    assert tl.ms_to_frame(16, 30) == 0      # 0.48 frame
    assert tl.ms_to_frame(17, 30) == 1      # 0.51 frame
    assert tl.ms_to_frame(1000, 24) == 24
    assert tl.ms_to_frame(10, 25) == 0      # 0.25
    assert tl.ms_to_frame(20, 25) == 1      # 0.5 -> up
    assert tl.ms_to_frame(10_000, 60) == 600


def test_frame_to_seconds_and_timecode():
    assert tl.frame_to_seconds(45, 30) == 1.5
    assert tl.frames_to_timecode(0, 30) == "00:00:00:00"
    assert tl.frames_to_timecode(30 * 3661 + 5, 30) == "01:01:01:05"
    assert tl.frames_to_timecode(59, 60) == "00:00:00:59"
    assert tl.frames_to_timecode(24 * 59 + 23, 24) == "00:00:59:23"


@pytest.mark.parametrize("fps", [24, 25, 30, 60])
def test_samples_are_exact_for_every_allowed_fps(fps):
    assert tl.samples_for_frames(fps, fps) == tl.SAMPLE_RATE      # one second
    for frames in (1, 7, 100, 1234):
        s = tl.samples_for_frames(frames, fps)
        assert s * fps == frames * tl.SAMPLE_RATE                  # no remainder anywhere


def test_samples_reject_inexact(tmp_path=None):
    with pytest.raises(tl.TimelineError):
        tl.samples_for_frames(1, 23)    # also an invalid fps
    with pytest.raises(tl.TimelineError):
        tl.ms_to_frame(100, 29)


def test_export_sizes_are_16_9_only():
    for w, h in tl.EXPORT_SIZES:
        assert w * 9 == h * 16
        assert tl.check_export_size(w, h) == (w, h)
    assert tl.export_scale(1920, 1080) == 1.5
    assert tl.export_scale(3840, 2160) == 3.0
    for bad in [(1920, 1200), (1280, 800), (1000, 562), (640, 360)]:
        with pytest.raises(tl.TimelineError):
            tl.check_export_size(*bad)


def _native():
    return parse_transcript(TRANSCRIPTS / "native.json", 30)


def test_boundaries_sit_inside_pauses():
    t = _native()
    w = t.words
    # beat 1 = words 0..3 ("The quick brown fox."), beat 2 = words 4..9; pause between fox. and It
    a = tl.beat_frame_range(w, 0, 3, 30, first=True, last=False)
    b = tl.beat_frame_range(w, 4, 9, 30, first=False, last=True)
    assert a[0] == 0
    cut = a[1]
    assert w[3].f1 <= cut <= w[4].f0
    assert cut == (w[3].f1 + w[4].f0) // 2          # integer midpoint
    assert b[0] == cut                              # contiguous
    assert b[1] == w[9].f1 + 18                     # tail: round(600 ms * 30/1000)
    tl.check_contiguous([a, b])


def test_every_internal_cut_is_inside_a_gap():
    w = _native().words
    for i in range(1, len(w)):
        f0, _ = tl.beat_frame_range(w, i, len(w) - 1, 30, first=False, last=True)
        assert w[i - 1].f1 <= f0 <= w[i].f0


@pytest.mark.parametrize("fps", [24, 25, 30, 60])
def test_tail_scales_with_fps(fps):
    w = parse_transcript(TRANSCRIPTS / "native.json", fps).words
    _, end = tl.beat_frame_range(w, 4, 9, fps, first=False, last=True, tail_ms=600)
    assert end == w[9].f1 + (600 * fps + 500) // 1000
    _, end2 = tl.beat_frame_range(w, 4, 9, fps, first=False, last=True, tail_ms=0)
    assert end2 == w[9].f1


def test_range_errors():
    w = _native().words
    with pytest.raises(tl.TimelineError):
        tl.beat_frame_range(w, 0, 3, 30, first=False, last=False)    # needs a previous word
    with pytest.raises(tl.TimelineError):
        tl.beat_frame_range(w, 4, 9, 30, first=False, last=False)    # needs a next word
    with pytest.raises(tl.TimelineError):
        tl.beat_frame_range(w, 5, 2, 30, first=False, last=True)


def test_contiguity():
    tl.check_contiguous([(0, 10), (10, 20), (20, 21)])
    with pytest.raises(tl.TimelineError, match="gap"):
        tl.check_contiguous([(0, 10), (11, 20)])
    with pytest.raises(tl.TimelineError, match="overlap"):
        tl.check_contiguous([(0, 10), (9, 20)])
    with pytest.raises(tl.TimelineError, match="empty"):
        tl.check_contiguous([(0, 10), (10, 10)])
    tl.check_contiguous([{"f0": 0, "f1": 5}, {"f0": 5, "f1": 9}])
