import numpy as np
import pytest

import helpers
from vbeat_audio import checks, runner, synth as S
from vbeat_audio.constants import SR

EXPECT = [
    ("a0_import_os", "A0"), ("a1_short", "A1"), ("a1_long", "A1"), ("a2_nan", "A2"), ("a2_quiet", "A2"),
    ("a2_silent", "A2"), ("a3_clip", "A3"), ("a4_dense_warn", "A4"), ("a4_dense_error", "A4"),
    ("a5_past_end", "A5"), ("a5_long_tail", "A5"), ("a6_sub_bass", "A6"), ("a6_hiss", "A6"),
    ("a9_far_anchor", "A9"), ("a9_unknown_anchor", "A9"), ("a10_dc", "A10"),
]


@pytest.mark.parametrize("script,fid", EXPECT)
def test_each_bad_script_fires_exactly_its_id(script, fid, tmp_path):
    env = helpers.render_file(helpers.bad(script), "base5", tmp_path)
    assert env["ok"] is True
    assert helpers.severe_ids(env["report"]) == {fid}, env["report"]["text"]
    assert env["report"]["ok"] is (env["report"]["counts"]["error"] == 0)


def test_severities(tmp_path):
    sev = lambda name: {f["id"]: f["severity"] for f in helpers.render_file(helpers.bad(name), "base5", tmp_path / name)["report"]["findings"]}  # noqa: E731
    assert sev("a1_short")["A1"] == "warn" and sev("a1_long")["A1"] == "error"
    assert sev("a2_quiet")["A2"] == "warn" and sev("a2_nan")["A2"] == "error"
    assert sev("a4_dense_warn")["A4"] == "warn" and sev("a4_dense_error")["A4"] == "error"


def test_report_shape_and_text_lines(tmp_path):
    env = helpers.render_file(helpers.bad("a4_dense_error"), "base5", tmp_path)
    r = env["report"]
    assert set(r) >= {"ok", "counts", "findings", "text"} and set(r["counts"]) == {"error", "warn"}
    for f in r["findings"]:
        assert set(f) == {"id", "severity", "t", "message", "data"} and f["severity"] in ("error", "warn", "info")
    lines = r["text"].split("\n")
    assert len(lines) == len(r["findings"])
    a4 = next(l for l in lines if l.startswith("A4 "))
    assert a4.startswith("A4 error @") and "sound events in 5.0s (limit about 3)" in a4 and a4.endswith("remove or group cues")
    assert r["counts"]["error"] == 1  # info is excluded from the counts


def test_a0_carries_line_and_source_text(tmp_path):
    env = helpers.render_file(helpers.bad("a0_import_os"), "base5", tmp_path)
    f = env["report"]["findings"][0]
    assert f["id"] == "A0" and f["data"]["line"] == 2 and "import os" in f["message"] and env["artifacts"] == {}


def test_a7_is_info_with_metrics(tmp_path):
    env = helpers.render_file(helpers.bad("ok_covered"), "base5", tmp_path)
    a7 = [f for f in env["report"]["findings"] if f["id"] == "A7"]
    assert len(a7) == 1 and a7[0]["severity"] == "info" and {"peak_dbfs", "rms_dbfs", "active_rms_dbfs"} <= set(a7[0]["data"])
    assert env["report"]["counts"] == {"error": 0, "warn": 0} and env["report"]["ok"]


def test_a8_lists_an_uncovered_marker_and_only_that(tmp_path):
    env = helpers.render_file(helpers.bad("a8_uncovered"), "base5", tmp_path)
    a8 = [f for f in env["report"]["findings"] if f["id"] == "A8"]
    assert len(a8) == 1 and a8[0]["severity"] == "info" and "land" in a8[0]["message"] and a8[0]["t"] == 1.2
    assert helpers.severe_ids(env["report"]) == set()
    ok = helpers.render_file(helpers.bad("ok_covered"), "base5", tmp_path / "ok")
    assert not [f for f in ok["report"]["findings"] if f["id"] == "A8"]


def test_a8_swoosh_started_early_counts_as_covered(tmp_path):
    src = "from synth import *\ndef render(ctx):\n    m = ctx.mix()\n    m.add(ctx.marker('land') - 0.2, swoosh(), name='s')\n    return m.render()\n"
    # the swoosh's own peak sits ~240 ms after its start, i.e. within 80 ms of the marker
    env = helpers.render_src(src, tmp_path)
    assert not [f for f in env["report"]["findings"] if f["id"] == "A8"]


def test_density_rules_directly():
    mk = lambda onsets, group=None: [{"name": "c", "kind": "single", "onset": t} for t in onsets]  # noqa: E731
    x = np.zeros(10)
    assert checks.check_density(mk([1.0, 3.0, 5.0]), x, 5.0) == []  # 3 in 5 s is fine
    assert checks.check_density(mk([1.0, 2.0, 3.0, 4.0]), x, 5.0)[0]["severity"] == "warn"
    assert checks.check_density(mk([float(i) * 0.5 for i in range(8)]), x, 5.0)[0]["severity"] == "error"
    assert checks.check_density(mk([0.5, 1.0]), x, 1.5) == []  # a hit plus an accent fits in a short beat
    group = [{"name": "g", "kind": "group", "onset": 1.0, "span": 1.5}]
    assert checks._events(group, x) == [(1.0, 3)]  # ceil(1.5 / 0.6)
    assert checks._events([{"name": "g", "kind": "group", "onset": 1.0, "span": 0.1}], x) == [(1.0, 1)]
    assert checks.check_density(group + mk([3.0]), x, 5.0)[0]["data"]["events"] == 4


def test_density_falls_back_to_energy_onsets_without_a_cue_log(tmp_path):
    src = ("import numpy as np\nfrom synth import *\ndef render(ctx):\n    out = np.zeros(ctx.samples)\n"
           "    p = pen_tick()\n    for i in range(9):\n        k = int((0.3 + 0.5 * i) * ctx.sr)\n        out[k:k + len(p)] += p\n    return out\n")
    env = helpers.render_src(src, tmp_path)
    assert helpers.severe_ids(env["report"]) == {"A4"} and env["report"]["findings"][0]["severity"] == "error"
    assert (tmp_path / "cues.json").read_text().strip() == "[]"


def test_clipping_detector_is_exact():
    x = np.zeros(1000)
    x[100:103] = 0.9
    x[500] = 0.9
    assert checks.check_clipping(x)[0]["data"]["longest"] == 3
    y = np.zeros(1000)
    y[100:102] = 0.9
    assert checks.check_clipping(y) == []  # two samples are not a clipping run
    assert checks.check_clipping(S.soft_pop().astype(np.float64)) == []


def test_validity_rules():
    assert checks.check_validity(np.array([0.0, np.inf]), 1)[0]["severity"] == "error"
    assert checks.check_validity(np.zeros(100), 0)[0]["severity"] == "error"
    assert checks.check_validity(np.full(100, 0.002), 1)[0]["severity"] == "warn"
    assert checks.check_validity(np.full(100, 0.2), 1) == []
    blip = np.zeros(48000)
    blip[10] = 0.1  # peak is fine, but there is no cue and almost no energy
    assert checks.check_validity(blip, 0)[0]["severity"] == "error"
    assert checks.check_validity(blip, 1) == []


def test_a5_message_names_the_cue(tmp_path):
    env = helpers.render_file(helpers.bad("a5_past_end"), "base5", tmp_path)
    f = next(f for f in env["report"]["findings"] if f["id"] == "A5")
    assert "late_chime" in f["message"] and "past the beat end" in f["message"]
    env = helpers.render_file(helpers.bad("a5_long_tail"), "base5", tmp_path / "t")
    f = next(f for f in env["report"]["findings"] if f["id"] == "A5")
    assert "long_rustle" in f["message"] and "1.2" in f["message"]


def test_cues_json_and_metrics_json(tmp_path):
    import json
    env = helpers.render_file(helpers.ROOT / "sfx" / "examples" / "stat_land.py", "stat_land", tmp_path)
    cues = json.loads(open(env["artifacts"]["cues"]).read())
    assert [c["name"] for c in cues] == ["count_ticks", "thunk", "chime"] and cues[0]["kind"] == "group" and cues[0]["n"] == 7
    m = json.loads(open(env["artifacts"]["metrics"]).read())
    assert m["samples"] == 240000 and abs(m["peak_dbfs"] + 6.0) < 0.05 and set(m["band_energy"]) >= {"below_50hz", "above_10khz"}
    assert m["cues"] == 3 and m["centroid_hz"] > 0 and "timing_ms" in m
