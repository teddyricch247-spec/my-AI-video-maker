"""Numeric descriptors and spectrogram maths shared by Mix, checks, preview, catalog and tests.

Depends only on numpy/scipy and constants (never on synth), so synth.Mix can import it.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage, signal

from .constants import SR

TAIL_DB = -50.0  # audible threshold relative to a cue's peak envelope


def db(x, floor=1e-12):
    """Amplitude ratio -> dB (20*log10), floored."""
    return 20.0 * np.log10(np.maximum(x, floor))


def envelope(x, win_ms=10.0):
    """Centred moving average of |x| over win_ms milliseconds (default 10), same length as x."""
    size = max(1, int(round(win_ms * SR / 1000.0)))
    return ndimage.uniform_filter1d(np.abs(np.asarray(x, dtype=np.float64)), size=size, mode="constant")


def peak_index(x) -> int:
    """Index of the loudest moment: argmax of the 10 ms smoothed envelope (used by Mix align='peak')."""
    return int(np.argmax(envelope(x)))


def audible_span(x, thresh_db=TAIL_DB):
    """(first, last) sample indices whose level is within thresh_db of the sound's peak."""
    a = np.abs(np.asarray(x, dtype=np.float64))
    if a.size == 0 or a.max() <= 0:
        return 0, 0
    env = envelope(a)
    first = int(np.argmax(a >= a.max() * 10 ** (thresh_db / 20.0)))
    idx = np.flatnonzero(env >= env.max() * 10 ** (thresh_db / 20.0))
    last = int(idx[-1]) if idx.size else a.size - 1
    return first, max(first, last)


def spectral_centroid(x) -> float:
    """Energy-weighted mean frequency in Hz of the whole signal."""
    x = np.asarray(x, dtype=np.float64)
    n = max(4096, 1 << int(np.ceil(np.log2(max(len(x), 2)))))
    p = np.abs(np.fft.rfft(x, n)) ** 2
    f = np.fft.rfftfreq(n, 1.0 / SR)
    s = p.sum()
    return float((f * p).sum() / s) if s > 0 else 0.0


def band_fractions(x, edges=(0, 50, 250, 1000, 4000, 10000, SR / 2 + 1)):
    """Fraction of total energy per band between consecutive edges (Hz)."""
    x = np.asarray(x, dtype=np.float64)
    n = max(4096, 1 << int(np.ceil(np.log2(max(len(x), 2)))))
    p = np.abs(np.fft.rfft(x, n)) ** 2
    f = np.fft.rfftfreq(n, 1.0 / SR)
    tot = p.sum()
    if tot <= 0:
        return [0.0] * (len(edges) - 1)
    return [float(p[(f >= lo) & (f < hi)].sum() / tot) for lo, hi in zip(edges[:-1], edges[1:])]


def rms(x) -> float:
    """Root-mean-square of the signal (linear)."""
    x = np.asarray(x, dtype=np.float64)
    return float(np.sqrt(np.mean(x * x))) if x.size else 0.0


def rms_active(x, win_ms=50.0, thresh_db=-40.0) -> float:
    """RMS over the 50 ms windows whose RMS is within 40 dB of the loudest window (linear)."""
    x = np.asarray(x, dtype=np.float64)
    w = max(1, int(win_ms * SR / 1000))
    n = len(x) // w
    if n == 0:
        return rms(x)
    frames = x[: n * w].reshape(n, w)
    r = np.sqrt((frames ** 2).mean(axis=1))
    if r.max() <= 0:
        return 0.0
    act = r >= r.max() * 10 ** (thresh_db / 20.0)
    return float(np.sqrt((frames[act] ** 2).mean()))


def descriptors(x) -> dict:
    """Duration (s), peak, rms, centroid (Hz), attack (ms), decay (ms to -30 dB), for one sound."""
    x = np.asarray(x, dtype=np.float64)
    if x.size == 0:
        return {"duration": 0.0, "peak": 0.0, "peak_dbfs": -120.0, "rms": 0.0, "centroid_hz": 0.0,
                "attack_ms": 0.0, "decay_ms": 0.0}
    env = envelope(x, 1.0)
    pk = int(np.argmax(env))
    m = env[pk]
    if m <= 0:
        return {"duration": len(x) / SR, "peak": 0.0, "peak_dbfs": -120.0, "rms": 0.0, "centroid_hz": 0.0,
                "attack_ms": 0.0, "decay_ms": 0.0}
    onset = int(np.argmax(env >= 0.1 * m))
    below = np.flatnonzero(env[pk:] <= m * 10 ** (-30 / 20.0))
    dec = (below[0] if below.size else len(env) - pk)
    peak = float(np.abs(x).max())
    return {
        "duration": round(len(x) / SR, 4), "peak": round(peak, 5), "peak_dbfs": round(float(db(peak)), 2),
        "rms": round(rms(x), 5), "centroid_hz": round(spectral_centroid(x), 1),
        "attack_ms": round(float(pk - onset) * 1000.0 / SR, 2), "decay_ms": round(float(dec) * 1000.0 / SR, 2),
    }


def onsets(x, frame_ms=10.0, min_gap_ms=80.0, rel_prominence=0.2):
    """Energy-onset times (s): peaks of the 10 ms RMS envelope. Used when no cue log exists (check A4)."""
    x = np.asarray(x, dtype=np.float64)
    h = max(1, int(frame_ms * SR / 1000))
    n = len(x) // h
    if n < 3:
        return []
    r = np.sqrt((x[: n * h].reshape(n, h) ** 2).mean(axis=1))
    if r.max() <= 0:
        return []
    r = ndimage.uniform_filter1d(r, 3)
    pk, _ = signal.find_peaks(r, prominence=rel_prominence * r.max(), distance=max(1, int(min_gap_ms / frame_ms)))
    # an onset is where the rise towards the peak starts
    out = []
    for p in pk:
        s = p
        while s > 0 and r[s - 1] < r[s] and r[s - 1] > 0.1 * r[p]:
            s -= 1
        out.append(s * h / SR)
    return out


def stft_db(x, win=2048, hop=512, range_db=70.0):
    """Magnitude STFT in dB relative to the global maximum, clipped to [-range_db, 0].

    Returns (freqs_hz, times_s, S) with S shaped (n_freq, n_frames); frame times are window centres.
    """
    x = np.asarray(x, dtype=np.float64)
    pad = win // 2
    xp = np.pad(x, (pad, pad + win))
    n_frames = 1 + max(0, len(x)) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = xp[idx] * np.hanning(win)[None, :]
    mag = np.abs(np.fft.rfft(frames, axis=1)).T
    m = mag.max()
    s = db(mag / m) if m > 0 else np.full_like(mag, -range_db)
    return np.fft.rfftfreq(win, 1.0 / SR), np.arange(n_frames) * hop / SR, np.clip(s, -range_db, 0.0)


def log_rows(S, freqs, n_rows, f_lo=60.0, f_hi=16000.0):
    """Resample an STFT (n_freq, n_frames) onto n_rows log-spaced frequency rows (row 0 = f_hi, top)."""
    f = np.geomspace(f_hi, f_lo, n_rows)
    pos = np.interp(f, freqs, np.arange(len(freqs)))
    i0 = np.clip(np.floor(pos).astype(int), 0, len(freqs) - 2)
    w = (pos - i0)[:, None]
    return S[i0] * (1 - w) + S[i0 + 1] * w
