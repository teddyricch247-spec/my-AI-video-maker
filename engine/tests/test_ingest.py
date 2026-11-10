import json

import pytest
from vbeat_shared.ingest import INTERPOLATED_WARNING, Transcript, parse_transcript
from helpers import TRANSCRIPTS


def _check_invariants(t):
    for i, w in enumerate(t.words):
        assert w.f0 < w.f1
        assert w.start_ms <= w.end_ms
        if i:
            p = t.words[i - 1]
            assert p.f1 <= w.f0, f"frames overlap at {w.id}"
            assert p.end_ms <= w.start_ms, f"times overlap at {w.id}"
    assert [w.id for w in t.words] == [f"w{i + 1:04d}" for i in range(len(t.words))]


def test_native_json():
    t = parse_transcript(TRANSCRIPTS / "native.json", 30)
    assert len(t.words) == 10 and not t.warnings
    assert (t.words[0].id, t.words[0].f0, t.words[0].f1) == ("w0001", 300, 305)
    assert t.duration_ms == 13800
    _check_invariants(t)


def test_whisper_json_seconds_and_leading_spaces():
    t = parse_transcript(TRANSCRIPTS / "whisper.json", 24)
    assert [w.text for w in t.words] == ["Hello", "there", "world.", "How", "are", "you?"]
    assert t.words[2].start_ms == 1200 and t.words[2].end_ms == 2000
    assert not t.warnings
    _check_invariants(t)


def test_whisper_top_level_words():
    text = json.dumps({"words": [{"word": "a", "start": 0.0, "end": 0.2}, {"word": "b.", "start": 0.3, "end": 0.6}]})
    t = parse_transcript(text, 30)
    assert [w.text for w in t.words] == ["a", "b."] and t.words[1].start_ms == 300


@pytest.mark.parametrize("name", ["sample.srt", "sample.vtt"])
def test_cues_are_interpolated_with_warning(name):
    t = parse_transcript(TRANSCRIPTS / name, 30)
    assert INTERPOLATED_WARNING in t.warnings
    assert [w.text for w in t.words][:4] == ["Hello", "brave", "new", "world."]
    # words stay inside their cue and are ordered; longer words get more time
    assert t.words[0].start_ms == 1000 and t.words[3].end_ms == 3000
    assert t.words[1].end_ms - t.words[1].start_ms >= t.words[2].end_ms - t.words[2].start_ms
    assert t.words[4].start_ms == 4000          # second cue (leading '- ' and tags stripped)
    assert "a" in [w.text for w in t.words] and "<i>" not in "".join(w.text for w in t.words)
    _check_invariants(t)


def test_vtt_short_timestamps_and_srt_text_input():
    t = parse_transcript(TRANSCRIPTS.joinpath("sample.vtt").read_text(), 30)   # text, not path
    assert t.words[-1].end_ms == 6500


def test_messy_transcript_is_cleaned_with_warnings():
    t = parse_transcript(TRANSCRIPTS / "messy.json", 30)
    texts = [w.text for w in t.words]
    assert texts[0] == "Hello,"                          # trimmed, punctuation merged into previous word
    assert "backwards" not in texts and "negative" not in texts
    assert "\u201cquoted" in texts                       # opening quote joins the next word
    joined = " | ".join(t.warnings)
    assert "dropped 2 word(s)" in joined
    assert "clamped" in joined and "adjusted" in joined
    _check_invariants(t)
    # tiny words are pushed forward, one frame each, never collapsed
    tiny = [w for w in t.words if w.text.startswith("tiny")]
    assert [w.f1 - w.f0 for w in tiny] == [1, 1, 1]


def test_sentence_end_ignores_trailing_quotes_and_brackets():
    t = parse_transcript(TRANSCRIPTS / "native.json", 30)
    flags = {w.text: w.sentence_end for w in t.words}
    assert flags["fox."] is True and flags['dog."'] is True and flags["quick"] is False
    m = parse_transcript(TRANSCRIPTS / "messy.json", 30)
    flags = {w.text: w.sentence_end for w in m.words}
    assert flags["end.)"] is True and flags["wow\u2026"] is True and flags["Hello,"] is False


def test_pauses():
    t = parse_transcript(TRANSCRIPTS / "native.json", 30)
    assert t.pauses() == [(4, 700)]                      # between "fox." and "It"
    assert t.pauses(min_ms=1) == [(4, 700)]              # no other gaps in this file
    assert t.pauses(min_ms=800) == []
    assert t.words[3].gap_after_ms == 700 and t.words[-1].gap_after_ms == 0
    m = parse_transcript(TRANSCRIPTS / "messy.json", 30)
    # 'overlapping' ends at 1200 ms and 'tiny' starts at 2000; 'end.)' ends 3000 and 'wow' starts 3600
    assert m.pauses(min_ms=250) == [(2, 800), (len(m.words) - 1, 600)]
    assert m.pauses(min_ms=700) == [(2, 800)]


def test_json_round_trip_and_ids_stable():
    t = parse_transcript(TRANSCRIPTS / "messy.json", 25)
    t2 = Transcript.from_json(t.to_json())
    assert t2 == t
    again = parse_transcript(t.to_json(), 25)            # our own output is valid native input
    assert [(w.id, w.f0, w.f1) for w in again.words] == [(w.id, w.f0, w.f1) for w in t.words]


def test_many_words_get_longer_ids():
    words = [{"text": "x", "start_ms": i * 10, "end_ms": i * 10 + 9} for i in range(10001)]
    t = parse_transcript(json.dumps({"words": words}), 60)
    assert t.words[0].id == "w0001" and t.words[-1].id == "w10001"


def test_bad_input():
    with pytest.raises(ValueError):
        parse_transcript("just some prose with no timing", 30)
    with pytest.raises(ValueError):
        parse_transcript('{"words": []}', 30)
    with pytest.raises(ValueError):
        parse_transcript('{"words": [{"text": "a", "start_ms": 5, "end_ms": 1}]}', 30)
    with pytest.raises(ValueError):
        parse_transcript(TRANSCRIPTS / "native.json", 29)


def test_random_messy_transcripts_always_satisfy_the_invariants():
    """Seeded fuzz: any input either raises ValueError or yields strictly ordered, frame-consistent words,
    and beats cut at random word boundaries are contiguous with every cut inside a pause."""
    import random
    from vbeat_shared import timeline as tl
    rnd = random.Random(1234)
    texts = ["a", "word", "Hello,", ",", ".", "\u201c", "end.", "x\u2026", "  pad  ", "", "\u2014", 'fox."', "(ok)", "12"]
    checked = 0
    for _ in range(300):
        fps = rnd.choice(tl.ALLOWED_FPS)
        t, words = 0, []
        for _ in range(rnd.randint(1, 40)):
            t += rnd.choice([0, 0, 1, 5, 20, 80, 300, 900])
            start = t + rnd.choice([0, 0, -30, 25])
            words.append({"text": rnd.choice(texts), "start_ms": start, "end_ms": start + rnd.choice([-50, 0, 1, 2, 40, 150, 400, 1200])})
        try:
            tr = parse_transcript(json.dumps({"words": words}), fps)
        except ValueError:
            continue
        _check_invariants(tr)
        w = tr.words
        assert all(x.start_ms >= 0 and x.gap_after_ms >= 0 and x.text == x.text.strip() and x.text for x in w)
        if len(w) >= 2:
            cuts = sorted(rnd.sample(range(1, len(w)), k=min(len(w) - 1, rnd.randint(1, 4))))
            bounds = [0] + cuts + [len(w)]
            beats = [tl.beat_frame_range(w, a, b - 1, fps, first=(a == 0), last=(b == len(w))) for a, b in zip(bounds, bounds[1:])]
            tl.check_contiguous(beats)
            for (a, b), (f0, f1) in zip(zip(bounds, bounds[1:]), beats):
                assert f0 <= w[a].f0 and f1 >= w[b - 1].f1
        checked += 1
    assert checked > 200
