import numpy as np
import pytest

from vbeat_audio import analysis as an
from vbeat_audio import synth as S
from vbeat_audio.constants import SR


def ok(x):
    assert x.dtype == np.float32 and x.ndim == 1 and np.isfinite(x).all() and len(x) > 0


@pytest.mark.parametrize("kind", ["sine", "tri", "saw", "square"])
def test_osc(kind):
    x = S.osc(kind, 440.0, 0.1)
    ok(x)
    assert len(x) == int(0.1 * SR) and np.abs(x).max() <= 1.05
    assert np.array_equal(x, S.osc(kind, 440.0, 0.1))
    sw = S.osc(kind, S.sweep(200, 800, 0.1), 0.1)  # per-sample frequency array
    ok(sw)


def test_osc_frequency_is_right():
    x = S.osc("sine", 1000.0, 0.5)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    assert abs(f[np.argmax(np.abs(np.fft.rfft(x)))] - 1000.0) < 3.0


@pytest.mark.parametrize("kind", ["white", "pink", "brown"])
def test_noise(kind):
    x = S.noise(kind, 0.5, seed=3)
    ok(x)
    assert np.array_equal(x, S.noise(kind, 0.5, seed=3))
    assert not np.array_equal(x, S.noise(kind, 0.5, seed=4))
    assert 0.2 < an.rms(x) < 0.3 and abs(x.mean()) < 0.02
    cen = an.spectral_centroid(x)
    assert cen > 1000 if kind == "white" else cen < 6000


def test_noise_tilt_order():
    c = {k: an.spectral_centroid(S.noise(k, 1.0, 1)) for k in ("white", "pink", "brown")}
    assert c["white"] > c["pink"] > c["brown"]


def test_envelopes():
    for e in (S.env_exp(0.2, 0.05), S.env_perc(0.2, 0.003, 0.05), S.env_adsr(0.3, 0.01, 0.05, 0.6, 0.1)):
        ok(e)
        assert 0.99 <= e.max() <= 1.0 + 1e-6 and e.min() >= 0
    e = S.env_exp(0.2, 0.05)
    assert abs(e[int(0.05 * SR)] - np.exp(-1)) < 1e-3
    p = S.env_perc(0.2, 0.01, 0.05)
    assert p[0] == 0 and abs(p[int(0.01 * SR)] - 1.0) < 0.01
    a = S.env_adsr(0.3, 0.01, 0.05, 0.6, 0.1)
    assert abs(a[int(0.15 * SR)] - 0.6) < 0.01 and a[-1] < 0.01


@pytest.mark.parametrize("curve", ["exp", "linear", "ease_in", "ease_out", "smooth"])
def test_sweep(curve):
    f = S.sweep(100.0, 1000.0, 0.2, curve)
    ok(f)
    assert abs(f[0] - 100) < 1 and abs(f[-1] - 1000) < 1 and np.all(np.diff(f) >= -1e-3)


def test_filters_attenuate():
    w = S.noise("white", 1.0, 1)
    lp, hp, bp = S.lowpass(w, 1000.0, 4), S.highpass(w, 4000.0, 4), S.bandpass(w, (1000.0, 2000.0), 3)
    for y in (lp, hp, bp):
        ok(y)
    assert an.band_fractions(lp, (0, 4000, SR))[1] < 0.01  # 4 kHz and above is gone
    assert an.band_fractions(hp, (0, 1000, SR))[0] < 0.01  # 1 kHz and below is gone
    assert an.band_fractions(bp, (0, 1000, 2000, SR))[1] > 0.8
    c = S.bandpass(w, 1500.0)  # one centre = one octave around it
    assert 900 < an.spectral_centroid(c) < 2500


def test_bandpass_sweep_moves():
    w = S.noise("white", 0.5, 2)
    y = S.bandpass_sweep(w, S.sweep(500, 4000, 0.5))
    ok(y)
    n = len(y) // 3
    assert an.spectral_centroid(y[:n]) < an.spectral_centroid(y[-n:])
    assert len(S.bandpass_sweep(w, 1000.0)) == len(w)


def test_resonator_and_modal():
    imp = np.zeros(SR // 2)
    imp[0] = 1
    r = S.resonator(imp, 1000.0, 0.05)
    ok(r)
    f = np.fft.rfftfreq(len(r), 1 / SR)
    assert abs(f[np.argmax(np.abs(np.fft.rfft(r)))] - 1000) < 5
    m = S.modal([200, 460], [0.1, 0.05], [1.0, 0.5], 0.3)
    ok(m)
    assert abs(np.abs(m).max() - 1.0) < 1e-6
    me = S.modal([200], [0.1], [1.0], 0.3, excite=np.hanning(48))
    ok(me)


def test_echo_and_room():
    x = S.pen_tick()
    e = S.echo(x, 0.1, 0.4, 0.5)
    ok(e)
    assert len(e) > len(x)
    i = int(0.1 * SR)
    assert np.abs(e[i: i + len(x)]).max() > 0.2 * np.abs(x).max()
    r = S.small_room(x, size=1.0, mix=0.3)
    ok(r)
    assert 0 < len(r) - len(x) <= int(0.25 * SR)  # reverb tail capped at 0.25 s
    assert np.array_equal(r, S.small_room(x, size=1.0, mix=0.3))


def test_small_utilities():
    x = np.linspace(-3, 3, 1000)
    sc = S.soft_clip(x, 2.0)
    ok(sc)
    assert abs(S.soft_clip(np.array([1.0]), 2.0)[0] - 1.0) < 1e-6  # +-1 in stays +-1
    assert np.abs(sc).max() <= 1.0 / np.tanh(2.0) + 1e-6 and np.all(np.diff(sc) >= 0)
    f = S.fade(np.ones(SR // 10), 10, 10)
    assert f[0] == 0 and f[-1] == 0 and f[len(f) // 2] == 1
    assert abs(S.gain_db(np.ones(4), 6.0)[0] - 1.9953) < 1e-3
    assert abs(np.abs(S.peak_normalize(np.array([0.1, -0.2]), 0.5)).max() - 0.5) < 1e-6
    assert np.all(S.peak_normalize(np.zeros(5)) == 0)
    assert len(S.silence(0.1)) == 4800
    a, b = np.ones(100, np.float32), np.ones(50, np.float32)
    assert len(S.concat([a, b], gap=0.001)) == 100 + 48 + 50
    o = S.overlay([a, b], [0.0, 0.001])
    assert len(o) == 100 and o[60] == 2.0
    with pytest.raises(ValueError):
        S.osc("sine", 100, -1)
    with pytest.raises(ValueError):
        S.noise("blue", 0.1)


def test_tick_times():
    lin = S.tick_times(1.0, 2.0, 5)
    assert lin[0] == 1.0 and lin[-1] == 2.0 and len(lin) == 5
    assert np.allclose(np.diff(lin), 0.25)
    acc = np.diff(S.tick_times(1.0, 2.0, 6, "ease_in"))
    dec = np.diff(S.tick_times(1.0, 2.0, 6, "ease_out"))
    assert np.all(np.diff(acc) < 0) and np.all(np.diff(dec) > 0)
    assert S.tick_times(0, 1, 1) == [0.0] and S.tick_times(0, 1, 0) == []


def test_every_low_level_function_is_float32_mono_finite_and_deterministic():
    w = S.noise("white", 0.2, 1)
    calls = {
        "osc": lambda: S.osc("saw", 300.0, 0.1), "noise": lambda: S.noise("pink", 0.1, 2),
        "env_adsr": lambda: S.env_adsr(0.1), "env_exp": lambda: S.env_exp(0.1, 0.02),
        "env_perc": lambda: S.env_perc(0.1), "sweep": lambda: S.sweep(100, 900, 0.1),
        "lowpass": lambda: S.lowpass(w, 800.0), "highpass": lambda: S.highpass(w, 800.0),
        "bandpass": lambda: S.bandpass(w, (500.0, 900.0)), "bandpass_sweep": lambda: S.bandpass_sweep(w, S.sweep(300, 3000, 0.2)),
        "resonator": lambda: S.resonator(w, 700.0, 0.03), "modal": lambda: S.modal([300, 700], [0.1, 0.05], [1, 0.5], 0.2),
        "echo": lambda: S.echo(w, 0.05), "small_room": lambda: S.small_room(w), "soft_clip": lambda: S.soft_clip(w),
        "fade": lambda: S.fade(w, 5, 5), "gain_db": lambda: S.gain_db(w, -3), "peak_normalize": lambda: S.peak_normalize(w),
        "concat": lambda: S.concat([w, w], 0.01), "overlay": lambda: S.overlay([w, w], [0, 0.01]), "silence": lambda: S.silence(0.1),
    }
    for name, make in calls.items():
        a, b = make(), make()
        ok(a)
        assert np.array_equal(a, b), name
