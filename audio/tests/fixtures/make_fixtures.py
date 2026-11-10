"""Regenerate engine inputs (engine/*.beat.json, *.markers.json) and SFX specs (specs/*.json) for the examples.

Run from the repo root:  PYTHONPATH=src python tests/fixtures/make_fixtures.py
"""
import json
from pathlib import Path

from vbeat_audio.spec import build_spec

HERE = Path(__file__).resolve().parent
SENT = lambda s: [(w, None, None) for w in s.split()]  # noqa: E731

# name: (fps, seconds, beat idx, [(text, start_s, end_s)], [(marker id, t, kind)])
BEATS = {
    "stat_land": (30, 5.0, 3, [("Revenue", .20, .70), ("grew", .75, 1.00), ("forty", 1.05, 1.45), ("percent", 1.45, 1.95),
                               ("in", 2.05, 2.15), ("a", 2.20, 2.25), ("single", 2.30, 2.80), ("year", 2.85, 3.40)],
                  [("land", 1.80, "thud")]),
    "flow_pops": (30, 8.0, 5, [("Ideas", .30, .80), ("become", .85, 1.30), ("drafts", 1.35, 2.00), ("then", 2.60, 2.90),
                               ("reviews", 2.95, 3.60), ("and", 4.00, 4.20), ("finally", 4.25, 4.90), ("ship", 6.30, 6.80)],
                  [("n1", 1.20, "pop"), ("a1", 2.40, "whoosh"), ("n2", 3.70, "pop"), ("a2", 5.10, "whoosh"), ("n3", 6.40, "pop")]),
    "checklist": (25, 10.0, 8, [("First", 1.00, 1.40), ("write", 1.45, 1.80), ("it", 1.85, 1.95), ("then", 3.20, 3.50),
                                ("test", 3.55, 3.95), ("it", 4.00, 4.10), ("finally", 5.80, 6.30), ("ship", 6.35, 6.80)],
                  [("i1", 2.00, "pop"), ("i2", 4.50, "pop"), ("i3", 7.00, "pop")]),
    "title_stamp": (24, 4.0, 1, [("Quarterly", .60, 1.20), ("Report", 1.25, 1.80)],
                    [("slide", .45, "slide"), ("stamp", 1.60, "stamp")]),
    "story_market": (60, 12.0, 12, [("The", .50, .62), ("market", .65, 1.10), ("opened", 1.15, 1.60), ("quietly", 1.65, 2.30),
                                    ("that", 2.35, 2.55), ("morning", 2.60, 3.20), ("until", 4.00, 4.40), ("a", 4.45, 4.50),
                                    ("bell", 4.55, 5.00), ("rang", 5.05, 5.50), ("somewhere", 5.55, 6.30)],
                     [("r1", .60, "rustle")]),
    "minimal": (30, 3.0, 2, [("Click", .30, .70), ("here", .75, 1.20), ("now", 1.25, 1.60)], []),
    "type_code": (30, 6.0, 9, [("Type", .40, .70), ("the", .75, .90), ("command", .95, 1.60), ("and", 3.00, 3.20),
                               ("press", 3.25, 3.60), ("enter", 3.65, 4.10)],
                  [("enter", 3.40, "tick")]),
    "base5": (30, 5.0, 4, [("The", .10, .30), ("quick", .35, .80), ("brown", .85, 1.30), ("fox", 1.35, 1.80),
                           ("jumps", 2.50, 3.00), ("high", 3.05, 3.50)],
              [("land", 1.20, "thud")]),
}

for name, (fps, secs, idx, words, markers) in BEATS.items():
    f0 = 10 * fps
    frames = round(secs * fps)
    beat = {"project": {"fps": fps, "width": 1920, "height": 1080},
            "beat": {"idx": idx, "f0": f0, "f1": f0 + frames},
            "words": [{"id": f"w{idx:02d}{i + 1:02d}", "text": t, "start_ms": 10000 + round(s * 1000),
                       "end_ms": 10000 + round(e * 1000), "f0": f0 + round(s * fps), "f1": f0 + round(e * fps)}
                      for i, (t, s, e) in enumerate(words)]}
    mk = [{"id": i, "t": t, "kind": k} for i, t, k in markers]
    (HERE / "engine" / f"{name}.beat.json").write_text(json.dumps(beat, indent=1))
    (HERE / "engine" / f"{name}.markers.json").write_text(json.dumps(mk, indent=1))
    (HERE / "specs" / f"{name}.json").write_text(json.dumps(build_spec(beat, mk), indent=1))
    print(name, frames, "frames", [w["id"] for w in beat["words"]][:3], "...")
