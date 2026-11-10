import numpy as np
import pytest
from scipy import signal

from vbeat_audio import analysis as an
from vbeat_audio import synth as S
from vbeat_audio.constants import SR


def third_centroids(x):
    n = len(x) // 3
    return an.spectral_centroid(x[:n]), an.spectral_centroid(x[-n:])


def mod_peak_hz(x, lo=2.0, hi=60.0, margin=0.1):
    """Frequency of the strongest amplitude modulation between lo and hi Hz (edges trimmed)."""
    a = np.abs(np.asarray(x, dtype=np.float64))
    a = a[int(margin * len(a)): int((1 - margin) * len(a))]
    a = a - a.mean()
    sos = signal.butter(2, 150, fs=SR, output="sos")
    e = signal.sosfilt(sos, np.abs(np.asarray(x, dtype=np.float64)))
    e = e[int(margin * len(e)): int((1 - margin) * len(e))]
    e = (e - e.mean()) * np.hanning(len(e))
    sp = np.abs(np.fft.rfft(e, 1 << 17))
    f = np.fft.rfftfreq(1 << 17, 1 / SR)
    band = (f >= lo) & (f <= hi)
    return float(f[band][np.argmax(sp[band])])


@pytest.mark.parametrize("name", sorted(S.RECIPES))
def test_every_recipe_basics(name):
    fn = S.RECIPES[name]
    x = fn()
    assert x.dtype == np.float32 and x.ndim == 1 and np.isfinite(x).all()
    assert abs(float(np.abs(x).max()) - 0.5) < 1e-3  # peak 0.5
    assert len(x) / SR <= 1.2  # no recipe longer than 1.2 s
    assert np.array_equal(np.asarray(x), np.asarray(fn()))  # deterministic
    assert abs(float(x[0])) < 0.05 and abs(float(x[-1])) < 0.05  # no click at the edges
    assert abs(float(np.mean(x))) < 0.01


@pytest.mark.parametrize("name", [n for n in sorted(S.RECIPES) if n not in ("chime", "coin_clink", "page_turn", "bubble_pop")])
def test_seed_changes_noise_based_recipes_only_when_they_take_a_seed(name):
    fn = S.RECIPES[name]
    try:
        a, b = np.asarray(fn(seed=1)), np.asarray(fn(seed=2))
    except TypeError:
        return
    assert np.array_equal(a, np.asarray(fn(seed=1)))
    if name in ("paper_slide", "paper_flick", "pen_scribble", "cloth_rustle", "swoosh", "type_keys"):
        assert not np.array_equal(a, b)


def test_wood_thunk_low_and_short():
    x = S.wood_thunk()
    assert an.spectral_centroid(x) < 600 and len(x) / SR <= 0.35
    f = np.fft.rfftfreq(1 << 16, 1 / SR)
    sp = np.abs(np.fft.rfft(x, 1 << 16))
    assert 120 < f[np.argmax(sp)] < 160
    assert an.spectral_centroid(S.wood_thunk(pitch=300)) > an.spectral_centroid(S.wood_thunk(pitch=100))


def test_stamp():
    x = S.stamp()
    assert len(x) / SR <= 0.4
    f = np.fft.rfftfreq(1 << 16, 1 / SR)
    sp = np.abs(np.fft.rfft(x, 1 << 16))
    low = (f > 50) & (f < 400)
    assert 90 <= f[low][np.argmax(sp[low])] <= 140
    slap = an.band_fractions(x[: int(0.06 * SR)], (0, 700, 3000, SR))[1]
    assert slap > 0.01  # the ink slap adds 700-3000 Hz energy
    assert an.spectral_centroid(S.stamp(2.0)) <= an.spectral_centroid(S.stamp(0.6)) + 50


def test_soft_pop():
    x = S.soft_pop()
    assert len(x) / SR <= 0.15 + 1e-9
    pad = np.pad(x, (0, int(0.3 * SR) - len(x)))
    env = an.envelope(pad, 5.0)
    assert 20 * np.log10(env[int(0.28 * SR):].max() / env.max() + 1e-12) < -30  # decayed within 300 ms
    assert abs(float(x[0])) < 0.01 and abs(float(x[-1])) < 0.01
    # pitch drops 1.35x -> 1x: instantaneous frequency from zero crossings early vs late
    def freq(seg):
        z = np.flatnonzero(np.diff(np.signbit(seg).astype(int)) != 0)
        return (len(z) - 1) / 2.0 / ((z[-1] - z[0]) / SR)
    early, late = freq(x[int(0.004 * SR): int(0.020 * SR)]), freq(x[int(0.07 * SR): int(0.12 * SR)])
    assert 1.15 < early / late < 1.5
    assert abs(late - 420) < 40
    sp = np.abs(np.fft.rfft(x[int(0.06 * SR):], 1 << 16))
    f = np.fft.rfftfreq(1 << 16, 1 / SR)
    assert sp[(f > 800) & (f < 1000)].max() < 0.05 * sp.max()  # a plain sine: no second harmonic


def test_bubble_pop_rises_then_falls():
    x = S.bubble_pop().astype(np.float64)
    assert len(x) / SR <= 0.065

    def freq(a_ms, b_ms):
        seg = x[int(a_ms * SR / 1000): int(b_ms * SR / 1000)]
        z = np.flatnonzero(np.diff(np.signbit(seg).astype(int)) != 0)
        return (len(z) - 1) / 2.0 / ((z[-1] - z[0]) / SR)
    start, middle, end = freq(0, 8), freq(20, 34), freq(40, 50)
    assert middle > 1.15 * start and middle > 1.1 * end  # a micro chirp: up, then down


def test_pen_tick_short_and_modes():
    x = S.pen_tick()
    assert len(x) / SR <= 0.08
    f = np.fft.rfftfreq(1 << 16, 1 / SR)
    sp = np.abs(np.fft.rfft(x, 1 << 16))
    for mult in (1.0, 1.6, 2.4):
        band = (f > 1800 * mult * 0.95) & (f < 1800 * mult * 1.05)
        assert sp[band].max() > 0.05 * sp.max()
    assert an.spectral_centroid(S.pen_tick(pitch=3000)) > an.spectral_centroid(S.pen_tick(pitch=1200))


def test_pen_scribble_modulation_14_to_20_hz():
    for seed in (0, 1, 2):
        assert 12.0 <= mod_peak_hz(S.pen_scribble(seed=seed), 5, 40) <= 22.0
    assert an.band_fractions(S.pen_scribble(), (0, 2500, 8000, SR))[1] > 0.8  # noise 3-7 kHz


@pytest.mark.parametrize("direction", ["up", "down"])
def test_swoosh_centroid_moves_the_right_way(direction):
    x = S.swoosh(direction=direction)
    a, b = third_centroids(x)
    assert (a < b) if direction == "up" else (a > b)
    env = an.envelope(x, 10.0)
    peak_pos = np.argmax(env) / len(env)
    assert 0.5 < peak_pos < 0.7  # peaks near 60% of its length
    assert len(x) / SR <= 0.4 + 1e-9


def test_swoosh_brightness():
    assert an.spectral_centroid(S.swoosh(bright=0.9)) > an.spectral_centroid(S.swoosh(bright=0.1))


def test_paper_slide_rises():
    a, b = third_centroids(S.paper_slide())
    assert a < b and 1000 < an.spectral_centroid(S.paper_slide()) < 6000


def test_paper_flick():
    x = S.paper_flick()
    assert len(x) / SR <= 0.12 + 1e-9
    assert an.band_fractions(x, (0, 1500, SR))[0] < 0.05  # nothing below ~2 kHz to speak of
    d = an.descriptors(x)
    assert d["attack_ms"] < 10 and d["decay_ms"] < 110


def test_page_turn_flap_at_the_end():
    x = S.page_turn()
    n = len(x)
    low = lambda seg: an.band_fractions(seg, (0, 80, 200, SR))[1] * np.sum(seg.astype(np.float64) ** 2)  # noqa: E731
    assert low(x[int(0.8 * n):]) > 5 * low(x[: n // 2])
    a, b = an.spectral_centroid(x[: int(0.3 * n)]), an.spectral_centroid(x[int(0.3 * n): int(0.8 * n)])
    assert a < b  # soft sweep rises


def test_click_short():
    x = S.click()
    assert len(x) / SR <= 0.1
    d = an.descriptors(x)
    assert d["attack_ms"] < 3 and abs(an.spectral_centroid(x) - 2200) < 1200


def test_chime_partial_ratios():
    pitch = 880.0
    x = S.chime(pitch)
    assert len(x) / SR <= 0.8 + 1e-9
    seg = x[: int(0.3 * SR)].astype(np.float64)
    nfft = 1 << 18
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), nfft))
    f = np.fft.rfftfreq(nfft, 1 / SR)
    peaks, _ = signal.find_peaks(sp, prominence=0.01 * sp.max())
    pf = f[peaks]
    for ratio in (1.0, 2.756, 5.404):
        near = pf[np.argmin(np.abs(pf - ratio * pitch))]
        assert abs(near / (ratio * pitch) - 1) < 0.01, (ratio, near)


def test_cloth_rustle_is_dull_and_flutters():
    x = S.cloth_rustle()
    assert an.spectral_centroid(x) < 3000
    assert an.band_fractions(x, (0, 4000, SR))[1] < 0.05
    m = mod_peak_hz(x, 4.0, 40.0)
    assert 7.0 <= m <= 26.0
    env = an.envelope(x, 10.0)[int(0.1 * len(x)): int(0.9 * len(x))]
    assert env.std() / env.mean() > 0.2  # amplitude flutter is audible


def test_type_keys_group_and_jitter():
    run = S.type_keys(n=6, rate=9, seed=0)
    assert len(run.events) == 6 and len(run) / SR <= 1.2
    for i, (off, dur) in enumerate(run.events):
        assert abs(off - i / 9.0) <= 0.025 + 1e-9
    ev = S.type_key_events(n=8, rate=12, seed=3)
    assert len(ev) == 8 and all(abs(o - i / 12.0) <= 0.025 + 1e-9 for i, (o, _) in enumerate(ev))
    f = np.fft.rfftfreq(1 << 16, 1 / SR)
    sp = np.abs(np.fft.rfft(run, 1 << 16))
    assert 150 < f[(f > 100) & (f < 400)][np.argmax(sp[(f > 100) & (f < 400)])] < 260  # the 200 Hz thock
    assert np.array_equal(np.asarray(run), np.asarray(S.type_keys(n=6, rate=9, seed=0)))


def test_coin_clink_two_pings():
    x = S.coin_clink()
    i, w = int(0.07 * SR), int(0.01 * SR)
    before, after = an.rms(x[i - w: i]), an.rms(x[i: i + w])
    assert after > 1.3 * before  # a second ping starts 70 ms after the first
    assert an.band_fractions(x, (0, 2000, 7000, SR))[1] > 0.7
    assert len(x) / SR <= 0.5


@pytest.mark.parametrize("surface", ["dirt", "wood", "paper"])
def test_footstep_soft(surface):
    x = S.footstep_soft(surface)
    assert 0.08 <= len(x) / SR <= 0.15 + 1e-9
    assert an.spectral_centroid(S.footstep_soft("paper")) > an.spectral_centroid(S.footstep_soft("dirt"))
    with pytest.raises(ValueError):
        S.footstep_soft("lava")
