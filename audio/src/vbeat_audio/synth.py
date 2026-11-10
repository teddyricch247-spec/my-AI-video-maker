"""Synthesis toolkit for cue scripts: low-level DSP, the Mix class and the sound recipes.

Every function returns float32 mono arrays at SR = 48000 and is deterministic (anything random takes a seed).
Times are in seconds, frequencies in Hz, levels in dB unless a docstring says otherwise.
Cue scripts use it as ``from synth import *``.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import signal as _signal

from . import analysis as _an
from .constants import SR

_MAX_DUR = 60.0

__all__ = [
    "SR", "osc", "noise", "env_adsr", "env_exp", "env_perc", "sweep", "lowpass", "highpass", "bandpass",
    "bandpass_sweep", "resonator", "modal", "echo", "small_room", "soft_clip", "fade", "gain_db",
    "peak_normalize", "concat", "overlay", "silence", "tick_times", "Mix", "Run", "RECIPES",
    "paper_slide", "paper_flick", "page_turn", "pen_tick", "pen_scribble", "soft_pop", "bubble_pop",
    "wood_thunk", "stamp", "swoosh", "click", "chime", "cloth_rustle", "type_keys", "type_key_events",
    "coin_clink", "footstep_soft",
]


# ----------------------------------------------------------------------------- helpers
def _n(dur):
    d = float(dur)
    if not math.isfinite(d) or d <= 0:
        raise ValueError(f"dur must be a positive number of seconds, got {dur!r}")
    if d > _MAX_DUR:
        raise ValueError(f"dur {d}s is longer than the {_MAX_DUR:.0f}s limit")
    return max(1, int(round(d * SR)))


def _f32(x):
    return np.asarray(x, dtype=np.float32)


def _t(n):
    return np.arange(n, dtype=np.float64) / SR


def _freq_array(freq, n):
    f = np.asarray(freq, dtype=np.float64)
    if f.ndim == 0:
        f = np.full(n, float(f))
    elif f.ndim != 1:
        raise ValueError("freq_hz must be a number or a 1-D per-sample array")
    elif len(f) != n:
        f = np.interp(np.linspace(0, len(f) - 1, n), np.arange(len(f)), f)
    return np.clip(f, 0.0, 0.49 * SR)


def _polyblep(t, dt):
    out = np.zeros_like(t)
    dt = np.maximum(dt, 1e-9)
    m = t < dt
    x = t[m] / dt[m]
    out[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    x = (t[m] - 1.0) / dt[m]
    out[m] = x * x + x + x + 1.0
    return out


def _finish(x, peak=0.5, fade_in_ms=0.3, fade_out_ms=8.0):
    """Edge fades (kill clicks), then peak-normalise; the common last step of every recipe."""
    return peak_normalize(fade(x, fade_in_ms, fade_out_ms, "cos"), peak)


def _mallet(ms):
    """Short Hann pulse of ms milliseconds used as modal excitation (shorter = brighter strike)."""
    return np.hanning(max(4, int(ms * SR / 1000.0)))



# ----------------------------------------------------------------------------- low level
def osc(kind, freq_hz, dur, phase=0.0):
    """Oscillator: kind sine|tri|saw|square, freq_hz (Hz, number or per-sample array), dur (s), phase (rad, 0).

    saw and square are band-limited (polyBLEP). Output amplitude is +-1.
    """
    n = _n(dur)
    f = _freq_array(freq_hz, n)
    cyc = phase / (2 * np.pi) + (np.cumsum(f) - f[0]) / SR
    if kind == "sine":
        y = np.sin(2 * np.pi * cyc)
    elif kind == "tri":
        y = (2.0 / np.pi) * np.arcsin(np.sin(2 * np.pi * cyc))
    elif kind in ("saw", "square"):
        t = cyc % 1.0
        dt = f / SR
        if kind == "saw":
            y = 2.0 * t - 1.0 - _polyblep(t, dt)
        else:
            y = np.where(t < 0.5, 1.0, -1.0) + _polyblep(t, dt) - _polyblep((t + 0.5) % 1.0, dt)
    else:
        raise ValueError("kind must be sine|tri|saw|square")
    return _f32(y)


def noise(kind, dur, seed=0):
    """Noise: kind white|pink|brown, dur (s), seed (int, 0). RMS is about 0.25, peak below 1.

    pink falls 3 dB/octave and brown 6 dB/octave above 20 Hz (spectrum shaped in the FFT domain).
    """
    n = _n(dur)
    w = np.random.default_rng(int(seed)).standard_normal(n)
    if kind == "white":
        y = w
    elif kind in ("pink", "brown"):
        sp = np.fft.rfft(w)
        f = np.maximum(np.fft.rfftfreq(n, 1.0 / SR), 20.0) / 20.0
        sp = sp / (np.sqrt(f) if kind == "pink" else f)
        sp[0] = 0.0
        y = np.fft.irfft(sp, n)
    else:
        raise ValueError("kind must be white|pink|brown")
    r = np.sqrt(np.mean(y * y))
    return _f32(np.clip(y * (0.25 / r if r > 0 else 0.0), -1.0, 1.0))


def env_exp(dur, tau):
    """Exponential decay envelope exp(-t/tau) from 1.0: dur (s), tau (s, time constant)."""
    return _f32(np.exp(-_t(_n(dur)) / max(float(tau), 1e-6)))


def env_perc(dur, attack=0.003, tau=0.05):
    """Percussive envelope: raised-cosine attack (s, 0.003) to 1.0, then exp decay with tau (s, 0.05)."""
    n = _n(dur)
    t = _t(n)
    a = max(float(attack), 1.0 / SR)
    y = np.where(t < a, 0.5 - 0.5 * np.cos(np.pi * np.minimum(t, a) / a), np.exp(-(t - a) / max(float(tau), 1e-6)))
    return _f32(y)


def env_adsr(dur, attack=0.01, decay=0.05, sustain=0.7, release=0.1):
    """Linear ADSR envelope over dur (s): attack, decay, release in s (0.01, 0.05, 0.1), sustain level 0..1 (0.7)."""
    n = _n(dur)
    total = attack + decay + release
    scale = min(1.0, dur / total) if total > 0 else 1.0
    a, d, r = attack * scale, decay * scale, release * scale
    t = _t(n)
    pts_t = [0.0, a, a + d, max(dur - r, a + d), dur]
    pts_v = [0.0, 1.0, sustain, sustain, 0.0]
    return _f32(np.interp(t, pts_t, pts_v))


def sweep(f0, f1, dur, curve="exp"):
    """Per-sample frequency trajectory in Hz from f0 to f1 over dur (s); curve exp|linear|ease_in|ease_out|smooth.

    Feed it to osc() as freq_hz or to bandpass_sweep() as centers. Returns float32 Hz values, not audio.
    """
    n = _n(dur)
    u = np.linspace(0.0, 1.0, n)
    if curve == "exp":
        if f0 <= 0 or f1 <= 0:
            raise ValueError("exp sweep needs f0 > 0 and f1 > 0")
        y = f0 * (f1 / f0) ** u
    else:
        shape = {"linear": u, "ease_in": u * u, "ease_out": 1 - (1 - u) ** 2, "smooth": u * u * (3 - 2 * u)}
        if curve not in shape:
            raise ValueError("curve must be exp|linear|ease_in|ease_out|smooth")
        y = f0 + (f1 - f0) * shape[curve]
    return _f32(y)


def _sos(btype, fc, order):
    wn = np.clip(fc, 5.0, 0.45 * SR)
    return _signal.butter(int(order), wn, btype=btype, fs=SR, output="sos")


def lowpass(x, fc, order=2):
    """Butterworth low-pass: x, cutoff fc (Hz), order (2). Causal sos filter."""
    return _f32(_signal.sosfilt(_sos("lowpass", float(fc), order), np.asarray(x, dtype=np.float64)))


def highpass(x, fc, order=2):
    """Butterworth high-pass: x, cutoff fc (Hz), order (2). Causal sos filter."""
    return _f32(_signal.sosfilt(_sos("highpass", float(fc), order), np.asarray(x, dtype=np.float64)))


def bandpass(x, band, order=2):
    """Butterworth band-pass: band is (lo_hz, hi_hz) or one centre in Hz (then one octave wide); order (2)."""
    if np.ndim(band) == 0:
        lo, hi = band / math.sqrt(2.0), band * math.sqrt(2.0)
    else:
        lo, hi = band
    lo, hi = max(float(lo), 5.0), min(float(hi), 0.45 * SR)
    if hi <= lo * 1.01:
        raise ValueError("bandpass needs hi > lo")
    sos = _signal.butter(int(order), [lo, hi], btype="bandpass", fs=SR, output="sos")
    return _f32(_signal.sosfilt(sos, np.asarray(x, dtype=np.float64)))


def bandpass_sweep(x, centers, q=1.5, order=2, n_bands=12):
    """Band-pass whose centre moves over time: x, centers (Hz per sample or one value), q (1.5), order (2).

    Cross-fades n_bands (12) fixed band-passes along the log-frequency trajectory, so there are no clicks.
    """
    x = np.asarray(x, dtype=np.float64)
    c = np.clip(_freq_array(centers, len(x)), 40.0, 0.4 * SR)
    lo_c, hi_c = float(c.min()), float(c.max())
    if hi_c / lo_c < 1.05:
        return bandpass(x, _qband(lo_c, q), order)
    nodes = np.geomspace(lo_c, hi_c, int(n_bands))
    pos = (np.log(c) - np.log(lo_c)) / (np.log(hi_c) - np.log(lo_c)) * (len(nodes) - 1)
    out = np.zeros_like(x)
    for k, fc in enumerate(nodes):
        w = np.maximum(0.0, 1.0 - np.abs(pos - k))
        if w.any():
            out += w * bandpass(x, _qband(fc, q), order)
    return _f32(out)


def _qband(fc, q):
    h = 1.0 / (2.0 * q)
    s = math.sqrt(1.0 + h * h)
    return fc * (s - h), min(fc * (s + h), 0.44 * SR)


def resonator(x, freq, decay):
    """Two-pole resonator: x, freq (Hz), decay (s, amplitude time constant). Unity gain at the resonance."""
    r = math.exp(-1.0 / (max(float(decay), 1e-4) * SR))
    w = 2 * np.pi * min(float(freq), 0.45 * SR) / SR
    b0 = (1 - r) * math.sqrt((1 - r) ** 2 * math.cos(w) ** 2 + (1 + r) ** 2 * math.sin(w) ** 2)
    return _f32(_signal.lfilter([b0], [1.0, -2 * r * math.cos(w), r * r], np.asarray(x, dtype=np.float64)))


def modal(freqs, decays, amps, dur, excite=None):
    """Modal synthesis: sum of decaying sines. freqs (Hz), decays (s, time constants), amps (linear), dur (s).

    excite: optional short array the mode bank is convolved with (a mallet or noise burst). Peak is 1.0.
    """
    n = _n(dur)
    t = _t(n)
    ir = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        if 0 < f < 0.49 * SR:
            ir += a * np.exp(-t / max(d, 1e-4)) * np.sin(2 * np.pi * f * t)
    if excite is not None:
        ir = _signal.fftconvolve(np.asarray(excite, dtype=np.float64), ir)[:n]
    return peak_normalize(ir, 1.0)


def echo(x, delay, feedback=0.3, mix=0.3, tail=0.6):
    """Feedback echo: delay (s), feedback 0..0.9 (0.3), mix = level of the first repeat vs dry 0..1 (0.3).

    The output is longer than x by the repeat tail, capped at `tail` seconds (0.6).
    """
    x = np.asarray(x, dtype=np.float64)
    d = max(1, int(round(delay * SR)))
    fb = min(max(float(feedback), 0.0), 0.9)
    extra = int(min(tail, 5 * delay + 0.3) * SR)
    out = np.pad(x, (0, extra))
    amp, k = float(mix), 1
    while amp > 0.003 and k * d < extra + len(x) // 2 and k * d < len(out):
        seg = out[k * d: k * d + len(x)]
        seg += amp * x[: len(seg)]
        amp *= fb
        k += 1
    return _f32(out)


def small_room(x, size=0.5, mix=0.2, seed=0):
    """Tiny room: size 0..1 (0.5), mix = wet level vs dry 0..1 (0.2). Reverb tail capped at 0.25 s.

    The output is longer than x by the impulse-response length (0.04 to 0.25 s).
    """
    x = np.asarray(x, dtype=np.float64)
    size = min(max(float(size), 0.0), 1.0)
    n_ir = int((0.04 + 0.21 * size) * SR)
    n_ir = min(n_ir, int(0.25 * SR))
    t = _t(n_ir)
    ir = np.random.default_rng(int(seed)).standard_normal(n_ir) * np.exp(-t / (n_ir / SR / 6.9))
    for ms, a in ((3, 0.7), (7, 0.5), (11, 0.4), (17, 0.3), (23, 0.22)):
        i = int(ms * (0.5 + size) * SR / 1000)
        if i < n_ir:
            ir[i] += a * 4
    ir = _signal.sosfilt(_sos("lowpass", 5000.0, 2), ir)
    ir /= math.sqrt(np.sum(ir * ir)) + 1e-12
    wet = _signal.fftconvolve(x, ir)
    out = np.pad(x, (0, len(wet) - len(x))) + float(mix) * wet
    return _f32(out)


def soft_clip(x, drive=2.0):
    """Tanh saturation: drive >0 (2.0); output is scaled so an input of +-1 stays +-1."""
    d = max(float(drive), 0.01)
    return _f32(np.tanh(d * np.asarray(x, dtype=np.float64)) / math.tanh(d))


def fade(x, in_ms=0.0, out_ms=0.0, curve="linear"):
    """Fade in and out: in_ms, out_ms (milliseconds, 0), curve linear|cos."""
    y = np.array(x, dtype=np.float64)
    for ms, rev in ((in_ms, False), (out_ms, True)):
        m = min(int(ms * SR / 1000.0), len(y) // 2)
        if m > 0:
            ramp = np.arange(m) / m
            if curve == "cos":
                ramp = 0.5 - 0.5 * np.cos(np.pi * ramp)
            if rev:
                y[-m:] *= ramp[::-1]
            else:
                y[:m] *= ramp
    return _f32(y)


def gain_db(x, db):
    """Scale by db decibels (negative is quieter)."""
    return _f32(np.asarray(x, dtype=np.float64) * 10 ** (db / 20.0))


def peak_normalize(x, peak=0.5):
    """Scale so the maximum absolute sample equals peak (linear, 0.5); silence stays silence."""
    x = np.asarray(x, dtype=np.float64)
    m = np.abs(x).max() if x.size else 0.0
    return _f32(x * (peak / m) if m > 0 else x)


def silence(dur):
    """Zeros for dur seconds."""
    return np.zeros(_n(dur), dtype=np.float32)


def concat(parts, gap=0.0):
    """Join arrays one after another with gap seconds (0.0) of silence between them."""
    g = np.zeros(int(round(gap * SR)), dtype=np.float32)
    seq = []
    for i, p in enumerate(parts):
        if i and len(g):
            seq.append(g)
        seq.append(_f32(p))
    return np.concatenate(seq) if seq else np.zeros(0, np.float32)


def overlay(parts, offsets=None):
    """Sum arrays; offsets are start times in seconds per part (default all 0). Length = longest end."""
    offs = [0.0] * len(parts) if offsets is None else list(offsets)
    starts = [int(round(o * SR)) for o in offs]
    total = max((s + len(p) for s, p in zip(starts, parts)), default=0)
    out = np.zeros(total, dtype=np.float64)
    for s, p in zip(starts, parts):
        out[s: s + len(p)] += np.asarray(p, dtype=np.float64)
    return _f32(out)


def tick_times(t0, t1, n, curve="linear"):
    """n event times (s) from t0 to t1 inclusive. curve linear | ease_in (gaps shrink, ticks accelerate)
    | ease_out (gaps grow, ticks settle)."""
    n = int(n)
    if n <= 0:
        return []
    if n == 1:
        return [float(t0)]
    u = np.linspace(0.0, 1.0, n)
    if curve == "linear":
        v = u
    elif curve == "ease_in":
        v = 1 - (1 - u) ** 2
    elif curve == "ease_out":
        v = u * u
    else:
        raise ValueError("curve must be linear|ease_in|ease_out")
    return [float(t0 + (t1 - t0) * k) for k in v]


# ----------------------------------------------------------------------------- Run and Mix
class Run(np.ndarray):
    """Array returned by multi-hit recipes (type_keys). Carries .events = [(offset_s, dur_s), ...] so
    Mix.add logs it as ONE group cue."""
    events: list


def _as_run(x, events):
    r = np.asarray(x, dtype=np.float32).view(Run)
    r.events = [(float(o), float(d)) for o, d in events]
    return r


def _r6(v):
    return None if v is None else round(float(v), 6)


class Mix:
    """Places sounds on the beat timeline and logs every cue. Mix(ctx).add(t, x, gain_db, name, anchor, align)."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.n = int(ctx.samples)
        self._buf = np.zeros(self.n, dtype=np.float64)
        self.cues = []
        reg = getattr(ctx, "_register_mix", None)
        if reg:
            reg(self)

    def _start_index(self, t, x, align):
        if align == "start":
            return int(round(float(t) * SR))
        if align == "peak":
            return int(round(float(t) * SR)) - _an.peak_index(x)
        if align == "end":
            return int(round(float(t) * SR)) - len(x)
        raise ValueError("align must be 'start', 'peak' or 'end'")

    def _insert(self, start, y):
        """Add y at start (may be negative / overflow). Returns (samples cut at start, samples cut at end)."""
        end = start + len(y)
        cut0, cut1 = max(0, -start), max(0, end - self.n)
        lo, hi = max(start, 0), min(end, self.n)
        if hi > lo:
            self._buf[lo:hi] += y[lo - start: hi - start]
        return cut0, cut1

    @staticmethod
    def _clean(x, what="x"):
        a = np.asarray(x, dtype=np.float64)
        if a.ndim != 1:
            raise ValueError(f"{what} must be a 1-D mono array, got shape {a.shape}")
        if a.size == 0:
            raise ValueError(f"{what} is empty")
        if not np.isfinite(a).all():
            raise ValueError(f"{what} contains NaN or inf")
        return a

    def _place(self, t, x, gain, align):
        if not math.isfinite(float(t)):
            raise ValueError(f"t must be a finite number of seconds, got {t!r}")
        if not math.isfinite(float(gain)):
            raise ValueError("gain_db must be finite")
        y = self._clean(x) * 10 ** (float(gain) / 20.0)
        start = self._start_index(t, y, align)
        cut0, cut1 = self._insert(start, y)
        first, last = _an.audible_span(y)
        pk = _an.peak_index(y)
        a0, a1 = (start + first) / SR, (start + last + 1) / SR
        info = {
            "onset": a0, "peak_t": (start + pk) / SR, "end": a1, "dur": len(y) / SR, "audible_dur": a1 - a0,
            "cut_start_s": cut0 / SR, "cut_end_s": cut1 / SR,
            "clipped_audible": bool(a0 < -0.001 or a1 > self.ctx.dur + 0.001),
            "peak": float(np.abs(y).max()),
        }
        return info

    def add(self, t, x, gain_db=0.0, name=None, anchor=None, align="start"):
        """Place sound x so it starts at t seconds (align 'start'), its loudest moment lands at t ('peak') or it
        ends at t ('end'). gain_db in dB (0.0). name and anchor (a marker or word id) are logged.

        A Run (type_keys) is logged as one group. Parts outside the beat are cut and logged.
        """
        ev = getattr(x, "events", None) if isinstance(x, Run) else None
        info = self._place(t, x, gain_db, align)
        label = name if name is not None else f"cue{len(self.cues)}"
        entry = {"name": str(label), "kind": "single", "t": _r6(t), "gain_db": _r6(gain_db), "anchor": anchor,
                 "align": align, "n": 1, "span": 0.0}
        if ev:
            offs = [o for o, _ in ev]
            entry.update(kind="group", n=len(ev), span=_r6(max(offs) - min(offs)),
                         times=[_r6(float(t) + o) for o in offs[:64]])
        entry.update({k: (_r6(v) if isinstance(v, float) else v) for k, v in info.items()})
        entry["anchor_t"] = _r6(self.ctx._anchor_time(anchor, float(t))) if anchor is not None else None
        entry["anchor_known"] = anchor is None or entry["anchor_t"] is not None
        self.cues.append(entry)

    def add_group(self, name, items, gain_db=0.0, anchor=None, align="start"):
        """Place several sounds [(t, x), ...] and log them as ONE texture cue (a run of ticks). gain_db (0.0)."""
        items = list(items)
        if not items:
            raise ValueError("add_group needs at least one (t, x) pair")
        infos = [self._place(t, x, gain_db, align) for t, x in items]
        ts = [float(t) for t, _ in items]
        onsets = [i["onset"] for i in infos]
        entry = {
            "name": str(name), "kind": "group", "t": _r6(min(ts)), "gain_db": _r6(gain_db), "anchor": anchor,
            "align": align, "n": len(items), "span": _r6(max(onsets) - min(onsets)), "times": [_r6(o) for o in onsets[:64]],
            "onset": _r6(min(onsets)), "peak_t": _r6(infos[int(np.argmax([i["peak"] for i in infos]))]["peak_t"]),
            "end": _r6(max(i["end"] for i in infos)), "dur": _r6(max(i["end"] for i in infos) - min(onsets)),
            "audible_dur": _r6(max(i["end"] for i in infos) - min(onsets)),
            "cut_start_s": _r6(sum(i["cut_start_s"] for i in infos)), "cut_end_s": _r6(sum(i["cut_end_s"] for i in infos)),
            "clipped_audible": any(i["clipped_audible"] for i in infos), "peak": _r6(max(i["peak"] for i in infos)),
        }
        entry["anchor_t"] = _r6(self.ctx._anchor_time(anchor, min(ts))) if anchor is not None else None
        entry["anchor_known"] = anchor is None or entry["anchor_t"] is not None
        self.cues.append(entry)

    def render(self):
        """Return the mixed float32 array of exactly ctx.samples samples."""
        return self._buf.astype(np.float32)


# ----------------------------------------------------------------------------- recipes
def paper_slide(dur=0.35, bright=0.5, seed=0):
    """Dry paper slide 'fff': pink noise, band centre sweeping 1 to 5 kHz (x bright), dur 0.35 s, bright 0..1."""
    n = _n(dur)
    k = 2.0 ** (float(bright) - 0.5)
    c = sweep(1000.0 * k, 5000.0 * k, dur, "exp")
    y = bandpass_sweep(noise("pink", dur, seed), c, q=1.2)
    u = np.linspace(0, 1, n)
    env = np.sin(np.pi * u ** 0.85) ** 2
    rough = 1.0 + 0.2 * lowpass(noise("white", dur, seed + 1), 60.0) / 0.05
    return _finish(y * env * np.clip(rough, 0.5, 1.5), fade_in_ms=2.0, fade_out_ms=10.0)


def paper_flick(dur=0.12, seed=0):
    """Card snap: noise 2 to 9 kHz, 1 ms attack, about 40 ms decay, dur 0.12 s."""
    y = lowpass(highpass(noise("white", dur, seed), 2000.0, 4), 9000.0)
    return _finish(y * env_perc(dur, 0.001, 0.040), fade_in_ms=0.2, fade_out_ms=15.0)


def page_turn(dur=0.5, seed=0):
    """Page turn: soft noise sweep 800 to 3000 Hz, then a small flap thump near 120 Hz at the end; dur 0.5 s."""
    n = _n(dur)
    sw = _n(dur * 0.82)
    u = np.linspace(0, 1, sw)
    body = bandpass_sweep(noise("pink", dur * 0.82, seed), sweep(800.0, 3000.0, dur * 0.82), q=1.0) * np.sin(np.pi * u) ** 2
    tt = _t(n)
    tstart = int((dur - 0.08) * SR)
    thump = np.zeros(n)
    m = n - tstart
    tm = tt[:m]
    thump[tstart:] = (np.sin(2 * np.pi * 120 * tm) * np.exp(-tm / 0.03) * (1 - np.exp(-tm / 0.003))).astype(np.float64)
    thump[tstart:] += 0.4 * lowpass(noise("white", 0.08, seed + 5), 400.0)[:m] * np.exp(-tm / 0.01)
    out = np.zeros(n)
    out[:sw] += peak_normalize(body, 0.35)
    out += peak_normalize(thump, 0.8)
    return _finish(out, fade_in_ms=2.0, fade_out_ms=10.0)


def pen_tick(pitch=1800.0, seed=0):
    """Felt-tip tick: modes at 1x, 1.6x, 2.4x of pitch (Hz, 1800), decays 15 to 40 ms, 2 ms noise; 70 ms total."""
    dur = 0.07
    exc = _mallet(0.2)
    y = modal([pitch, 1.6 * pitch, 2.4 * pitch], [0.025, 0.040, 0.015], [1.0, 0.6, 0.35], dur, exc)
    burst = highpass(noise("white", 0.002, seed), 3000.0) * np.hanning(int(0.002 * SR))
    y = y + 0.5 * np.pad(burst, (0, len(y) - len(burst)))
    return _finish(y, fade_in_ms=0.1, fade_out_ms=15.0)


def pen_scribble(dur=0.5, seed=0):
    """Pen scribble: noise 3 to 7 kHz, amplitude-modulated 14 to 20 Hz (seeded), dur 0.5 s."""
    n = _n(dur)
    rng = np.random.default_rng(int(seed) + 11)
    y = bandpass(noise("white", dur, seed), (3000.0, 7000.0), 3)
    rate = np.clip(17.0 + np.cumsum(rng.standard_normal(n)) / np.sqrt(n) * 2.0 * 6, 14.0, 20.0)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * (np.cumsum(rate) / SR) + rng.uniform(0, 6.28))
    am = am ** 1.5
    u = np.linspace(0, 1, n)
    env = np.minimum(1.0, u * dur / 0.03) * np.minimum(1.0, (1 - u) * dur / 0.08)
    return _finish(y * (0.15 + 0.85 * am) * env, fade_in_ms=3.0, fade_out_ms=20.0)


def soft_pop(pitch=420.0, seed=0):
    """Soft pop: sine falling 1.35x to 1x pitch (Hz, 420) over 40 ms, 3 ms attack, tau 45 ms, 3 kHz lowpass; 150 ms."""
    dur = 0.15
    n = _n(dur)
    t = _t(n)
    f = pitch * 1.35 ** np.clip(1.0 - t / 0.04, 0.0, 1.0)  # 1.35x -> 1x over 40 ms, then steady
    y = osc("sine", f, dur) * env_perc(dur, 0.003, 0.045)
    y = lowpass(y, 3000.0)
    return _finish(y, fade_in_ms=0.0, fade_out_ms=40.0)


def bubble_pop(pitch=700.0, seed=0):
    """Bubble pop: 60 ms micro chirp rising then falling around pitch (Hz, 700), fast attack, quick decay."""
    dur = 0.06
    n = _n(dur)
    u = np.linspace(0, 1, n)
    f = pitch * (0.85 + 0.75 * np.sin(np.pi * u ** 0.8))
    env = env_perc(dur, 0.004, 0.025)
    return _finish(osc("sine", f, dur) * env, fade_in_ms=0.0, fade_out_ms=12.0)


def wood_thunk(pitch=140.0, size=1.0, seed=0):
    """Wood thunk: modes 1x, 2.3x, 3.7x of pitch (Hz, 140), decays 120/70/40 ms x size^0.5, 5 ms thump; <=350 ms."""
    dur = 0.33
    s = max(float(size), 0.2) ** 0.5
    mallet = _mallet(1.2)
    y = modal([pitch, 2.3 * pitch, 3.7 * pitch], [0.12 * s, 0.07 * s, 0.04 * s], [1.0, 0.55, 0.3], dur, mallet)
    thump = lowpass(noise("white", 0.005, seed), 800.0) * np.hanning(int(0.005 * SR))
    y = y + 0.5 * np.pad(thump, (0, len(y) - len(thump)))
    return _finish(y, fade_in_ms=0.0, fade_out_ms=40.0)


def stamp(weight=1.0, seed=0):
    """Rubber stamp: wood_thunk at 90 to 140 Hz (lower when weight is higher) plus a 1.5 kHz ink slap, 60 ms; <=400 ms."""
    w = max(float(weight), 0.1)
    pitch = float(np.clip(125.0 / w ** 0.4, 90.0, 140.0))
    th = wood_thunk(pitch, size=w, seed=seed)
    dur = len(th) / SR
    slap = bandpass(noise("white", 0.06, seed + 3), (800.0, 2600.0), 2) * env_perc(0.06, 0.0007, 0.02)
    slap = np.pad(slap, (0, len(th) - len(slap)))
    y = th.astype(np.float64) + peak_normalize(slap, 0.4)
    return _finish(y, fade_in_ms=0.0, fade_out_ms=40.0)


def swoosh(dur=0.4, direction="up", bright=0.5, seed=0):
    """Swoosh: band-passed noise, centre 400 to 3500 Hz (x bright 0..1) rising ('up') or falling ('down'); peak at 60%."""
    n = _n(dur)
    k = 2.0 ** (float(bright) - 0.5)
    lo, hi = 400.0, min(3500.0 * k, 9000.0)
    if direction == "up":
        c = sweep(lo, hi, dur, "exp")
    elif direction == "down":
        c = sweep(hi, lo, dur, "exp")
    else:
        raise ValueError("direction must be 'up' or 'down'")
    y = bandpass_sweep(noise("pink", dur, seed), c, q=1.2)
    u = np.linspace(0, 1, n)
    alpha = math.log(0.5) / math.log(0.6)
    env = np.sin(np.pi * u ** alpha) ** 2
    return _finish(y * env, fade_in_ms=2.0, fade_out_ms=8.0)


def click(soft=0.5, seed=0):
    """UI click: 2 ms noise plus a 2.2 kHz sine with 15 ms decay, soft 0..1 (0.5; higher is rounder); 60 ms."""
    dur = 0.06
    s = min(max(float(soft), 0.0), 1.0)
    nb = int(0.002 * SR)
    burst = highpass(noise("white", 0.002, seed), 1000.0) * np.hanning(nb)
    y = osc("sine", 2200.0, dur) * env_perc(dur, 0.0004 + 0.0012 * s, 0.015)
    y = y + (1.0 - 0.6 * s) * 1.2 * np.pad(burst, (0, len(y) - nb)) / (np.abs(burst).max() + 1e-9) * 0.5
    return _finish(y, fade_in_ms=0.0, fade_out_ms=15.0)


def chime(pitch=880.0, seed=0):
    """Small bell: bar-mode partials at 1x, 2.756x, 5.404x of pitch (Hz, 880), decays 600/250/120 ms; 0.8 s."""
    dur = 0.8
    mallet = _mallet(0.3)
    y = modal([pitch, 2.756 * pitch, 5.404 * pitch], [0.6, 0.25, 0.12], [1.0, 0.45, 0.22], dur, mallet)
    return _finish(y, fade_in_ms=0.0, fade_out_ms=150.0)


def cloth_rustle(dur=0.5, seed=0):
    """Cloth rustle: noise low-passed near 1.5 kHz with seeded amplitude flutter at 8 to 25 Hz, dur 0.5 s."""
    n = _n(dur)
    y = highpass(lowpass(noise("white", dur, seed), 1500.0, 3), 150.0)
    rng = np.random.default_rng(int(seed) + 7)
    t = _t(n)
    fl = sum(np.sin(2 * np.pi * f0 * t + ph) for f0, ph in zip(rng.uniform(8.0, 25.0, 3), rng.uniform(0, 6.28, 3))) / 3.0
    fl = fl + 0.25 * lowpass(rng.standard_normal(n), 40.0) / 0.3
    env = np.clip(0.55 + 0.6 * fl, 0.12, 1.0)
    u = np.linspace(0, 1, n)
    shape = np.minimum(1.0, u * dur / 0.08) * np.minimum(1.0, (1 - u) * dur / 0.12)
    return _finish(y * env * shape, fade_in_ms=3.0, fade_out_ms=20.0)


def _key(rng):
    s = int(rng.integers(0, 2 ** 31))
    dur = 0.07
    nb = int(0.0015 * SR)
    ck = highpass(noise("white", 0.0015, s), 2500.0) * np.hanning(nb)
    ck = np.pad(ck, (0, int(dur * SR) - nb))
    thock = osc("sine", 200.0 * (0.95 + 0.1 * rng.random()), dur) * env_perc(dur, 0.001, 0.02)
    y = peak_normalize(ck, 0.5) * 0.6 + peak_normalize(thock, 0.5)
    return fade(peak_normalize(y, 0.5), 0.0, 10.0, "cos")


def type_key_events(n=6, rate=9.0, seed=0):
    """Key presses as [(offset_s, array), ...] for Mix.add_group: n keys (6), rate keys/s (9), jitter <=25 ms."""
    rng = np.random.default_rng(int(seed))
    jit = min(0.025, 0.25 / max(rate, 1e-6))
    out = []
    for i in range(int(n)):
        off = max(0.0, i / rate + (rng.uniform(-jit, jit) if i else 0.0))
        k = _key(rng)
        out.append((float(off), k * float(0.7 + 0.3 * rng.random())))
    return out


def type_keys(n=6, rate=9.0, seed=0):
    """Typing run: n key clicks (6) with a 200 Hz thock at rate keys per second (9), jitter <=25 ms.

    Returns a Run (peak 0.5) that Mix.add logs as one group; type_key_events gives the parts for add_group.
    """
    ev = type_key_events(n, rate, seed)
    total = max(o for o, _ in ev) + 0.08
    out = np.zeros(int(round(total * SR)))
    for o, k in ev:
        i = int(round(o * SR))
        out[i: i + len(k)] += k
    return _as_run(peak_normalize(out, 0.5), [(o, len(k) / SR) for o, k in ev])


def coin_clink(pitch=2600.0, seed=0):
    """Ceramic coin clink: two pings 70 ms apart, partials 1x, 1.6x, 2.3x of pitch (Hz, 2600), decays 150 ms."""
    dur = 0.4
    n = _n(dur)
    mallet = _mallet(0.12)

    def ping(p, d):
        return modal([p, 1.6 * p, 2.3 * p], [d, d * 0.6, d * 0.4], [1.0, 0.5, 0.3], dur, mallet)

    out = np.zeros(n)
    out += ping(pitch, 0.15)
    i = int(0.07 * SR)
    out[i:] += 0.9 * ping(pitch * 1.12, 0.15)[: n - i]
    return _finish(out, fade_in_ms=0.0, fade_out_ms=60.0)


def footstep_soft(surface="dirt", seed=0):
    """Soft footstep: low thump plus filtered noise on surface dirt|wood|paper, 120 to 150 ms."""
    if surface == "dirt":
        dur, f, tau = 0.13, 70.0, 0.03
        nz = lowpass(noise("white", dur, seed), 900.0) * env_perc(dur, 0.004, 0.03)
        body = osc("sine", f, dur) * env_perc(dur, 0.003, tau)
        y = peak_normalize(body, 1.0) + 0.7 * peak_normalize(nz, 1.0)
    elif surface == "wood":
        dur = 0.12
        body = modal([110.0, 250.0, 410.0], [0.04, 0.025, 0.015], [1.0, 0.5, 0.3], dur, _mallet(1.5))
        nz = bandpass(noise("white", dur, seed), (300.0, 1500.0)) * env_perc(dur, 0.002, 0.02)
        y = body + 0.4 * peak_normalize(nz, 1.0)
    elif surface == "paper":
        dur = 0.15
        n = _n(dur)
        crinkle = highpass(noise("white", dur, seed), 1500.0)
        rng = np.random.default_rng(int(seed) + 2)
        am = np.clip(lowpass(rng.standard_normal(n), 120.0) * 12.0, 0.0, None) + 0.2
        body = osc("sine", 90.0, dur) * env_perc(dur, 0.003, 0.025)
        y = 0.6 * peak_normalize(body, 1.0) + peak_normalize(lowpass(crinkle, 6500.0) * am * env_perc(dur, 0.002, 0.05), 1.0)
    else:
        raise ValueError("surface must be dirt|wood|paper")
    return _finish(y, fade_in_ms=0.0, fade_out_ms=20.0)


RECIPES = {
    "paper_slide": paper_slide, "paper_flick": paper_flick, "page_turn": page_turn, "pen_tick": pen_tick,
    "pen_scribble": pen_scribble, "soft_pop": soft_pop, "bubble_pop": bubble_pop, "wood_thunk": wood_thunk,
    "stamp": stamp, "swoosh": swoosh, "click": click, "chime": chime, "cloth_rustle": cloth_rustle,
    "type_keys": type_keys, "coin_clink": coin_clink, "footstep_soft": footstep_soft,
}
