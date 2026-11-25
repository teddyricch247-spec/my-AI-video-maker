#!/usr/bin/env python3
"""Pacing and tone metrics of a video: camera beats per minute, % still, % fast, hard cuts, mean L*.

usage: python analyze_pacing.py VIDEO [--ffmpeg ffmpeg] [--fps 30] [--json out.json]

Definitions (the same ones the targets in the skill were measured with):
- frames are decoded at 180x320 (portrait; use --size 320x180 for landscape) and every 4th pixel is kept;
- change10 = mean absolute luma change (0-255) between frames 10 apart, smoothed over 5 frames;
- a camera BEAT is a peak of change10 above 20, peaks at least 12 frames apart;
- STILL frames have change10 < 8, FAST frames change10 > 35;
- a HARD CUT is an ffmpeg scene score > 0.3 (the same metric as select='gt(scene,0.3)');
- L* is CIE L* of every pixel (sRGB, D65), averaged per frame and over the video.
Targets for a viral-style 3D cartoon Short: 56 +- 4 beats/min, still ~5-20%, fast <= 35%, cuts ~0, mean L* >= 50.
Needs numpy and ffmpeg.
"""
import argparse
import json
import re
import subprocess

import numpy as np

BEAT_K, BEAT_T, STILL_T, FAST_T, CUT_T = 10, 20.0, 8.0, 35.0, 0.3


def frames(path, ff, w, h):
    raw = subprocess.run([ff, "-v", "error", "-i", path, "-vf", f"scale={w}:{h}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def scene_scores(path, ff, n):
    err = subprocess.run([ff, "-hide_banner", "-i", path, "-vf", "select='gte(scene,0)',metadata=print", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    sc = [float(m) for m in re.findall(r"lavfi[.]scene_score=([0-9.]+)", err)]
    out = np.zeros(n)
    out[: min(n, len(sc))] = sc[:n]
    return out


def lstar(rgb):
    c = rgb.astype(np.float32) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    f = np.where(y > 216 / 24389, np.cbrt(y), (24389 / 27 * y + 16) / 116)
    return 116 * f - 16


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--size", default="180x320", help="decode size WxH (portrait default)")
    ap.add_argument("--json", help="write the metrics here")
    a = ap.parse_args()
    w, h = map(int, a.size.lower().split("x"))
    fr = frames(a.video, a.ffmpeg, w, h)
    n = len(fr)
    dur = n / a.fps
    g = fr[:, ::4, ::4].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    d = np.zeros(n)
    d[BEAT_K:] = np.abs(g[BEAT_K:] - g[:-BEAT_K]).mean((1, 2))
    ds = np.convolve(d, np.ones(5) / 5, "same")
    peaks = [i for i in range(1, n - 1) if ds[i] >= ds[i - 1] and ds[i] > ds[i + 1] and ds[i] > BEAT_T]
    sel = []
    for p in sorted(peaks, key=lambda i: -ds[i]):
        if all(abs(p - q) >= 12 for q in sel):
            sel.append(p)
    beats = sorted(max(0, p - BEAT_K // 2) for p in sel)
    sc = scene_scores(a.video, a.ffmpeg, n)
    cuts = [i for i in range(1, n) if sc[i] > CUT_T]
    L = np.array([lstar(f[::2, ::2]).mean() for f in fr])
    per10 = [sum(1 for b in beats if k * 10 <= b / a.fps < (k + 1) * 10) for k in range(int(np.ceil(dur / 10)))]
    m = {
        "frames": n, "duration_s": round(dur, 2),
        "beats": len(beats), "beats_per_min": round(len(beats) / dur * 60, 1), "beats_per_10s": per10,
        # the first BEAT_K frames have no frame 10 back (change10 = 0): leave them out of still/fast
        "frac_still": round(float((ds[BEAT_K:] < STILL_T).mean()), 3), "frac_fast": round(float((ds[BEAT_K:] > FAST_T).mean()), 3),
        "hard_cuts": len(cuts), "cut_times_s": [round(c / a.fps, 2) for c in cuts],
        "L_mean": round(float(L.mean()), 1), "L_p5": round(float(np.percentile(L, 5)), 1), "L_p95": round(float(np.percentile(L, 95)), 1),
        "beat_times_s": [round(b / a.fps, 2) for b in beats],
    }
    print(json.dumps({k: v for k, v in m.items() if k != "beat_times_s"}, indent=1))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(m, fh, indent=1)


if __name__ == "__main__":
    main()
