import pytest
from helpers import SCENES, good_scene, png_bytes, write_spec
from vbeat_sprite import checks
from vbeat_sprite.spec import load_spec


def _run(tmp_path, scene, level="full", **kw):
    media = kw.pop("media", None)
    spec = load_spec(write_spec(tmp_path, scene, media=media, **kw))
    return checks.run_checks(spec, level)


def _ids(report, severity=None):
    return sorted({f["id"] for f in report["findings"] if severity in (None, f["severity"])})


def test_good_scene_passes_both_levels_with_no_findings(tmp_path):
    for level in ("fast", "full"):
        r = _run(tmp_path, good_scene(), level)
        assert r["ok"] and r["counts"] == {"error": 0, "warn": 0} and r["findings"] == [], r["text"]
        assert r["text"] == "OK: no findings"


@pytest.mark.parametrize("scene,expected", [
    ("c1_random.js", "C1"),
    ("c2_console.js", "C2"),
    ("c2_loadfail.js", "C2"),
    ("c3_throw.js", "C3"),
    ("c4_offcanvas.js", "C4"),
    ("c5_overlap.js", "C5"),
    ("c6_blank_start.js", "C6"),
    ("c7_static.js", "C7"),
    ("c8_counter.js", "C8"),
])
def test_each_broken_scene_fires_exactly_its_check(scene, expected, tmp_path):
    r = _run(tmp_path, SCENES / scene)
    assert not r["ok"]
    assert _ids(r) == [expected], r["text"]
    assert _ids(r, "error") == [expected]


def test_c9_missing_and_corrupt_media(tmp_path):
    r = _run(tmp_path, good_scene(), media={"img1": "does_not_exist.png"})
    assert _ids(r) == ["C9"] and "img1" in r["text"], r["text"]
    (tmp_path / "empty.png").write_bytes(b"")
    r = _run(tmp_path, good_scene(), media={"img1": "empty.png"})
    assert _ids(r) == ["C9"], r["text"]
    (tmp_path / "ok.png").write_bytes(png_bytes(8, 8, (9, 9, 9)))
    r = _run(tmp_path, good_scene(), media={"img1": "ok.png"})
    assert r["ok"] and r["findings"] == []


def test_fast_level_runs_only_c1_c2_c3_c6(tmp_path):
    # C7 / C8 / C4 / C5 are full-level checks: a static scene passes fast, fails full
    assert _run(tmp_path, SCENES / "c7_static.js", "fast")["ok"]
    assert _run(tmp_path, SCENES / "c4_offcanvas.js", "fast")["ok"]
    assert _run(tmp_path, SCENES / "c8_counter.js", "fast")["ok"]
    # C1, C3, C6 are fast
    assert _ids(_run(tmp_path, SCENES / "c1_random.js", "fast")) == ["C1"]
    assert _ids(_run(tmp_path, SCENES / "c3_throw.js", "fast")) == ["C3"]
    assert _ids(_run(tmp_path, SCENES / "c6_blank_start.js", "fast")) == ["C6"]


def test_report_shape_and_text(tmp_path):
    r = _run(tmp_path, SCENES / "c4_offcanvas.js")
    assert set(r) >= {"ok", "counts", "findings", "text"}
    f = r["findings"][0]
    assert set(f) == {"id", "severity", "t", "message", "data"}
    assert r["text"].splitlines()[0].startswith("C4 error @0.00s: text 'HELLO' exceeds right edge by ")
    assert len(r["text"].splitlines()) == len(r["findings"])
    lint = _run(tmp_path, SCENES / "c1_random.js")["findings"][0]
    assert lint["data"]["line"] == 3 and lint["data"]["column"] == 8       # position of Math.random


def test_c6_allow_blank_start(tmp_path):
    r = _run(tmp_path, SCENES / "c6_blank_start.js", allow_blank_start=True)
    assert r["ok"] and r["findings"] == [], r["text"]


def test_c3_samples_cover_last_frame(tmp_path):
    spec = load_spec(write_spec(tmp_path, SCENES / "c3_throw.js", frames=45))      # throws only after t > 1, last t = 1.4667
    r = checks.run_checks(spec, "fast")
    assert r["findings"][0]["id"] == "C3" and r["findings"][0]["t"] == 44 / 30


def test_full_check_is_fast_enough_for_a_6s_beat(tmp_path):
    r = _run(tmp_path, good_scene())
    assert r["timing_ms"]["total"] < 20000 and not r["sampling"]["thinned"]


def test_hang_is_reported_as_c3(tmp_path):
    spec = load_spec(write_spec(tmp_path, SCENES / "hang.js"))
    r = checks.run_checks(spec, "fast", sampling_timeout=3)
    assert not r["ok"] and "infinite loop" in r["text"] and _ids(r) == ["C3"]


def test_oversized_scene_is_a_c2_finding(tmp_path):
    r = _run(tmp_path, SCENES / "huge.js", "fast")
    assert _ids(r) == ["C2"] and "bytes" in r["text"]


def test_one_cause_gives_one_finding_for_unparsable_or_drawless_scenes(tmp_path):
    for scene, needle in (("c1_syntax.js", "parse error"), ("no_draw.js", "must export")):
        r = _run(tmp_path, SCENES / scene, "fast")
        assert [f["id"] for f in r["findings"]] == ["C1"] and needle in r["text"], r["text"]


def test_sampling_is_thinned_not_skipped_when_over_budget(tmp_path):
    from vbeat_sprite.browser import BrowserSession
    spec = load_spec(write_spec(tmp_path, good_scene()))
    with BrowserSession(spec) as s:
        page = s.new_page()
        page.init()
        times = [k * 0.5 for k in range(12)] + [179 / 30]
        res = page.ok("pageChecks", {"level": "full", "c3Times": times, "c7Times": [k * 0.25 for k in range(24)],
                                     "lastT": 179 / 30, "budgetMs": 1})["sampling"]
        assert res["thinned"] is True and 2 <= res["c3_samples"] < len(times)   # fewer samples, first/last kept
        assert res["c7_samples"] == 24                                          # other checks still run
