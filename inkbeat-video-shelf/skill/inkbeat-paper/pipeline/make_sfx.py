#!/usr/bin/env python3
"""Deterministic offline SFX-only WAV generator from scene markers JSON.

Usage:
  python3 pipeline/make_sfx.py --markers /tmp/inkbeat-work/markers.json --seconds 12 --out /tmp/inkbeat-work/sfx.wav

NO voice-over and NO music are generated. Pure one-shot paper/foliage/motion SFX
(pop, tick, whoosh, thud, slide, rustle, chime) leveled modestly (~-16 dBFS) so
they sit cleanly under a voice-over added later in an editor.
"""
import argparse, json, math, random, struct, wave

SR = 48000


def _env(i, n, att_s=0.004, rel_s=0.03):
    a = max(1, int(att_s * SR))
    r = max(1, int(rel_s * SR))
    k = 1.0
    if i < a:
        k *= i / a
    if i > n - r:
        k *= max(0.0, (n - i) / r)
    return k


def synth_sfx(kind, seed=1):
    rng = random.Random(seed)
    if kind == "tick":
        dur = 0.055
        n = int(dur * SR)
        out = []
        for i in range(n):
            t = i / SR
            v = math.sin(2 * math.pi * (1450 - 700 * t / dur) * t) * math.exp(-t * 68)
            v += 0.25 * (rng.random() * 2 - 1) * math.exp(-t * 95)
            out.append(0.20 * v * _env(i, n, 0.002, 0.015))
        return out
    if kind == "pop":
        dur = 0.11
        n = int(dur * SR)
        out = []
        for i in range(n):
            t = i / SR
            f = 340 + 480 * math.exp(-t * 28)
            v = math.sin(2 * math.pi * f * t) * math.exp(-t * 32)
            out.append(0.24 * v * _env(i, n, 0.003, 0.025))
        return out
    if kind == "thud":
        dur = 0.18
        n = int(dur * SR)
        out = []
        for i in range(n):
            t = i / SR
            f = 135 - 75 * (t / dur)
            v = math.sin(2 * math.pi * f * t) * math.exp(-t * 18)
            v += 0.12 * (rng.random() * 2 - 1) * math.exp(-t * 40)
            out.append(0.28 * v * _env(i, n, 0.004, 0.04))
        return out
    if kind == "whoosh":
        dur = 0.28
        n = int(dur * SR)
        out = []
        lp = 0.0
        for i in range(n):
            u = i / n
            arch = math.sin(math.pi * u) ** 1.4
            noise = rng.random() * 2 - 1
            alpha = 0.05 + 0.18 * arch
            lp = lp + alpha * (noise - lp)
            out.append(0.20 * lp * arch * _env(i, n, 0.02, 0.05))
        return out
    if kind == "slide" or kind == "rustle":
        dur = 0.22 if kind == "slide" else 0.16
        n = int(dur * SR)
        out = []
        lp = 0.0
        for i in range(n):
            u = i / n
            arch = math.sin(math.pi * u)
            noise = rng.random() * 2 - 1
            lp = lp + 0.28 * (noise - lp)
            hp = noise - lp
            out.append(0.14 * hp * arch * _env(i, n, 0.01, 0.04))
        return out
    # chime (soft paper-bell accent)
    dur = 0.35
    n = int(dur * SR)
    out = []
    for i in range(n):
        t = i / SR
        v = (0.7 * math.sin(2 * math.pi * 880 * t) + 0.3 * math.sin(2 * math.pi * 1320 * t)) * math.exp(-t * 9)
        out.append(0.18 * v * _env(i, n, 0.005, 0.08))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--markers", required=True, help="JSON file of [{id, t, kind}]")
    ap.add_argument("--seconds", type=float, required=True, help="total timeline duration")
    ap.add_argument("--out", required=True, help="output WAV path")
    a = ap.parse_args()

    markers = json.load(open(a.markers, encoding="utf-8"))
    total_n = max(1, int(round(a.seconds * SR)))
    buf = [0.0] * total_n

    for idx, m in enumerate(markers):
        t = float(m.get("t", 0))
        if t < 0 or t >= a.seconds:
            continue
        kind = str(m.get("kind", "tick"))
        samp = synth_sfx(kind, seed=idx + 17)
        start = int(round(t * SR))
        for j, v in enumerate(samp):
            if start + j < total_n:
                buf[start + j] += v

    with wave.open(a.out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        pcm = bytearray()
        for v in buf:
            clamped = max(-0.85, min(0.85, v))
            pcm.extend(struct.pack("<h", int(round(clamped * 32767))))
        wf.writeframes(bytes(pcm))
    print(f"Wrote SFX stem ({len(markers)} cues, {a.seconds:.2f}s) -> {a.out}")


if __name__ == "__main__":
    main()
