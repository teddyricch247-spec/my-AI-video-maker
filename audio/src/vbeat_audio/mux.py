"""Mux a mono 48 kHz wav into an existing video without re-encoding the picture.

Experiments (ffmpeg 6.1) behind the choices: ``-af "pan=stereo|c0=1.0*c0|c1=1.0*c0"`` duplicates the mono
channel to both sides at unity gain (verified: both channels peak at the input peak); aac in .mp4 reports
the exact audio duration thanks to the edit list; a truncated wav gives a much shorter audio stream, which
the duration check below turns into a failure.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from .constants import SR

PAN_FILTER = "pan=stereo|c0=1.0*c0|c1=1.0*c0"
AAC_TOL_S = 0.025
CODECS = {"aac": (".mp4", ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]),
          "pcm_mov": (".mov", ["-c:a", "pcm_s16le"])}


class MuxError(RuntimeError):
    """ffmpeg failed or the verification of the result failed."""


def probe(path) -> dict:
    """ffprobe summary: {'video': [streams], 'audio': [streams], 'format_duration': s}; packet-counted, no decode."""
    r = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-show_streams", "-show_format", "-of", "json",
                        str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise MuxError(f"ffprobe failed on {path}: {r.stderr.strip()[:300]}")
    j = json.loads(r.stdout)
    out = {"video": [], "audio": [], "format_duration": float(j.get("format", {}).get("duration", 0) or 0)}
    for s in j.get("streams", []):
        info = {"codec": s.get("codec_name"), "duration": float(s.get("duration", 0) or 0),
                "packets": int(s.get("nb_read_packets", 0) or 0)}
        if s.get("codec_type") == "video":
            info.update(width=s.get("width"), height=s.get("height"), fps=s.get("avg_frame_rate"))
            out["video"].append(info)
        elif s.get("codec_type") == "audio":
            info.update(sample_rate=int(s.get("sample_rate", 0) or 0), channels=int(s.get("channels", 0) or 0))
            out["audio"].append(info)
    return out


def _verify(src, dst, codec):
    a, b = probe(src), probe(dst)
    if not a["video"]:
        raise MuxError("input has no video stream")
    if len(b["video"]) != 1:
        raise MuxError(f"output has {len(b['video'])} video streams, expected exactly 1")
    if len(b["audio"]) != 1:
        raise MuxError(f"output has {len(b['audio'])} audio streams, expected exactly 1")
    v0, v1, au = a["video"][0], b["video"][0], b["audio"][0]
    if v1["codec"] != v0["codec"]:
        raise MuxError(f"video codec changed from {v0['codec']} to {v1['codec']} (it must be copied)")
    if v1["packets"] != v0["packets"]:
        raise MuxError(f"video frame count changed from {v0['packets']} to {v1['packets']}")
    if au["sample_rate"] != SR or au["channels"] != 2:
        raise MuxError(f"audio is {au['sample_rate']} Hz / {au['channels']} ch, expected {SR} Hz / 2 ch")
    want = "aac" if codec == "aac" else "pcm_s16le"
    if au["codec"] != want:
        raise MuxError(f"audio codec is {au['codec']}, expected {want}")
    tol = AAC_TOL_S if codec == "aac" else 1.0 / SR + 1e-6
    diff = au["duration"] - v1["duration"]
    if abs(diff) > tol:
        raise MuxError(f"audio is {au['duration']:.3f}s but video is {v1['duration']:.3f}s (difference {diff:+.3f}s, "
                       f"allowed {tol * 1000:.3f} ms)")
    return {"video": v1, "audio": au, "av_diff_s": round(diff, 6)}


def mux(video, wav, out, codec="aac") -> dict:
    """Copy the video stream of `video` untouched, add the mono `wav` as stereo audio, write `out`.

    codec 'aac' -> AAC 192k, 48 kHz, .mp4 with +faststart; 'pcm_mov' -> pcm_s16le in .mov. Verifies with ffprobe
    and raises MuxError (deleting the output) when anything is off. Returns the verification summary.
    """
    if codec not in CODECS:
        raise MuxError(f"codec must be one of {', '.join(CODECS)}")
    suffix, acodec = CODECS[codec]
    out = Path(out)
    if out.suffix.lower() != suffix:
        raise MuxError(f"codec {codec} needs an output path ending in {suffix}, got {out.name}")
    for p, what in ((video, "video"), (wav, "wav")):
        if not Path(p).is_file():
            raise MuxError(f"{what} file not found: {p}")
    w = probe(wav)
    if not w["audio"] or w["audio"][0]["sample_rate"] != SR or w["audio"][0]["channels"] != 1:
        raise MuxError(f"wav must be mono {SR} Hz; got {w['audio']}")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.stem}.partial{suffix}")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0",
           "-c:v", "copy", "-af", PAN_FILTER, "-ar", str(SR), *acodec, str(tmp)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise MuxError(f"ffmpeg failed: {r.stderr.strip()[-400:]}")
    try:
        summary = _verify(video, tmp, codec)
    except MuxError:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, out)
    return summary
