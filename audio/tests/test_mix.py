import numpy as np
import pytest

import helpers
from vbeat_audio import analysis as an
from vbeat_audio import synth as S
from vbeat_audio.constants import SR
from vbeat_audio.ctx import Ctx, UnknownIdError


def ctx():
    return Ctx(helpers.spec("base5"))


def test_render_is_exactly_ctx_samples():
    c = ctx()
    m = c.mix()
    assert m.render().shape == (c.samples,) and m.render().dtype == np.float32
    m.add(1.0, S.soft_pop())
    assert len(m.render()) == c.samples == 240000


@pytest.mark.parametrize("make", [S.wood_thunk, S.swoosh, S.chime, S.stamp, S.soft_pop])
def test_align_peak_lands_within_1ms(make):
    c = ctx()
    m = c.mix()
    t = 2.0
    x = make()
    m.add(t, x, align="peak")
    buf = m.render().astype(np.float64)
    landed = an.peak_index(buf) / SR
    assert abs(landed - t) < 0.001


def test_align_start_and_end():
    c = ctx()
    m = c.mix()
    m.add(1.0, np.ones(480, np.float32), align="start")
    m.add(3.0, np.ones(480, np.float32), align="end")
    buf = m.render()
    assert buf[48000] == 1 and buf[47999] == 0
    assert buf[3 * 48000 - 1] == 1 and buf[3 * 48000] == 0


def test_clipping_at_both_ends_is_logged_and_safe():
    c = ctx()
    m = c.mix()
    m.add(-0.05, S.wood_thunk(), name="early")
    m.add(c.dur - 0.05, S.chime(), name="late")
    log = {e["name"]: e for e in m.cues}
    assert log["early"]["cut_start_s"] > 0 and log["early"]["clipped_audible"]
    assert log["late"]["cut_end_s"] > 0 and log["late"]["clipped_audible"]
    assert len(m.render()) == c.samples
    m.add(c.dur + 3.0, S.soft_pop(), name="gone")  # entirely outside: no crash
    assert m.cues[-1]["cut_end_s"] > 0


def test_group_counts_once_in_the_log():
    c = ctx()
    m = c.mix()
    m.add_group("ticks", [(1.0 + 0.1 * i, S.pen_tick()) for i in range(6)])
    assert len(m.cues) == 1 and m.cues[0]["kind"] == "group" and m.cues[0]["n"] == 6
    assert abs(m.cues[0]["span"] - 0.5) < 0.01 and len(m.cues[0]["times"]) == 6
    m.add(2.5, S.type_keys(n=6, rate=9), name="typing")  # a Run is logged as a group too
    assert m.cues[1]["kind"] == "group" and m.cues[1]["n"] == 6


def test_log_fields_and_anchor():
    c = ctx()
    m = c.mix()
    m.add(1.2, S.wood_thunk(), gain_db=-4, name="thunk", anchor="land", align="peak")
    e = m.cues[0]
    assert e["name"] == "thunk" and e["gain_db"] == -4 and e["anchor"] == "land" and e["align"] == "peak"
    assert e["anchor_t"] == 1.2 and e["anchor_known"] and e["dur"] > 0.3
    assert abs(e["peak"] - 0.5 * 10 ** (-4 / 20)) < 1e-3
    m.add(1.0, S.soft_pop(), anchor="w0402")
    assert m.cues[1]["anchor_known"]
    m.add(1.0, S.soft_pop(), anchor="missing")
    assert not m.cues[2]["anchor_known"]


def test_gain_is_applied():
    c = ctx()
    m = c.mix()
    m.add(0.5, np.full(100, 0.5, np.float32), gain_db=-6.0206)
    assert abs(m.render()[24000 + 5] - 0.25) < 1e-4


def test_bad_inputs_raise_clear_errors():
    m = ctx().mix()
    with pytest.raises(ValueError):
        m.add(1.0, np.zeros((10, 2)))
    with pytest.raises(ValueError):
        m.add(1.0, np.array([0.0, np.nan]))
    with pytest.raises(ValueError):
        m.add(float("nan"), S.soft_pop())
    with pytest.raises(ValueError):
        m.add(1.0, S.soft_pop(), align="middle")
    with pytest.raises(ValueError):
        m.add_group("x", [])


def test_ctx_api():
    c = ctx()
    assert c.at("w0402") == c.words[1]["start"] and c.at("w0402", "end", 0.25) == c.words[1]["end"] + 0.25
    assert c.marker("land") == 1.2 and c.marker_times("thud") == [1.2] and c.marker_times("pop") == []
    with pytest.raises(UnknownIdError, match="nearest ids: w04"):
        c.at("w0499")
    with pytest.raises(UnknownIdError, match="nearest ids: land"):
        c.marker("lan")
    try:
        c.at("zzz")
    except UnknownIdError as e:
        assert len(str(e).split("nearest ids: ")[1].split(", ")) == 5  # 5 nearest of 6 words
    with pytest.raises(ValueError):
        c.at("w0401", "middle")
    a, b = c.rng("x").random(4), c.rng("x").random(4)
    assert np.array_equal(a, b) and not np.array_equal(a, c.rng("y").random(4)) and not np.array_equal(a, c.rng(1).random(4))
    other = helpers.spec("base5")
    other["seed"] = 9
    assert not np.array_equal(a, Ctx(other).rng("x").random(4))
