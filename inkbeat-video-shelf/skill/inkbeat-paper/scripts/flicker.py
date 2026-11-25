#!/usr/bin/env python3
"""One-frame flicker check for a rendered video.

usage: python flicker.py VIDEO [--threshold 4.0] [--ffmpeg ffmpeg] [--top 10]

A broken render tab (lost GL state under GPU overload) draws every Nth frame darker or unlit. Such a frame differs
from BOTH neighbors while the neighbors agree, so on a per-frame luma track it is a one-frame spike. Real cuts
change once and stay, so they don't trigger. Each frame is measured on a 4x3 grid, so a local spike counts too.
Legit one-frame events (a flash, a whip) also spike but cluster in time; a broken tab repeats with the tab stride,
so the verdict is a stride test: >= 5 spikes on one residue modulo some k in 2..16, at least sqrt(frames on that
residue) of them, and > 2.5x the average of the other residues.

Prints the spikes, the strongest "odd one out" frames (to look at with their neighbors) and the stride verdict.
Exit code 3 when a stride pattern is found. Needs numpy and ffmpeg on PATH (or --ffmpeg).
"""
import argparse
import subprocess
import sys

import numpy as np

W, H = 64, 36


def tiles(path, ff):
    r = subprocess.run([ff, "-v", "error", "-i", path, "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
                       capture_output=True)
    if r.returncode:
        sys.exit(f"ffmpeg could not read {path}: {r.stderr.decode(errors='replace').strip()[-300:]}")
    raw = r.stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
    return f.reshape(len(f), 3, H // 3, 4, W // 4).mean(axis=(2, 4)).reshape(len(f), 12)


def spikes(y, th):
    a, b, c = y[:-2], y[1:-1], y[2:]
    spike = np.minimum(np.abs(b - a), np.abs(b - c))
    cons = np.abs(a - c)
    hit = (spike > th) & (cons < spike * 0.35)
    return np.where(hit.any(axis=1))[0] + 1, (spike - 0.5 * cons).max(axis=1)


def stride(bad, n):
    """(k, residue, hits) of the strongest fixed-stride pattern, or None"""
    best = None
    for k in range(2, 17):
        cnt = np.bincount(bad % k, minlength=k)
        r = int(cnt.argmax())
        frames = (n - r + k - 1) // k
        if cnt[r] >= 5 and cnt[r] >= 0.25 * frames ** 0.5 * 4 and cnt[r] > 2.5 * (cnt.sum() - cnt[r]) / max(1, k - 1):
            if best is None or cnt[r] > best[2]:
                best = (k, r, int(cnt[r]))
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--threshold", type=float, default=4.0, help="luma change (0-255) that counts as a spike")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--top", type=int, default=10, help="how many strongest odd-one-out frames to list")
    a = ap.parse_args()
    y = tiles(a.video, a.ffmpeg)
    bad, score = spikes(y, a.threshold)
    st = stride(bad, len(y))
    print(f"{a.video}: {len(y)} frames, {len(bad)} spikes; stride pattern: {st}")
    if len(bad):
        print("spike frames:", " ".join(str(int(f)) for f in bad[:200]) + (" ..." if len(bad) > 200 else ""))
    order = np.argsort(-score)[: a.top]
    print("strongest odd-one-out frames (frame, time s, score):",
          ", ".join(f"({int(i) + 1}, {(int(i) + 1) / a.fps:.2f}, {score[i]:.1f})" for i in order))
    sys.exit(3 if st else 0)


if __name__ == "__main__":
    main()
