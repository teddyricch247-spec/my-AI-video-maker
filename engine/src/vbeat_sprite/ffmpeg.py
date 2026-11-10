"""ffmpeg / ffprobe wrappers: a streaming PNG -> H.264 encoder and output verification."""
from __future__ import annotations

import json
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from fractions import Fraction
from pathlib import Path
from typing import Any


class FfmpegError(RuntimeError):
    """ffmpeg/ffprobe is missing or failed."""


class VerificationError(RuntimeError):
    """The encoded file does not match what was asked for."""


def require_tools() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise FfmpegError(f"{tool} not found on PATH")


def encode_args(fps: int, out: Path, crf: int = 18, preset: str = "medium") -> list[str]:
    # RGB PNG -> BT.709 limited-range yuv420p. The explicit out_color_matrix matters: without it swscale
    # uses BT.601 while the stream is tagged bt709, and colours drift (measured: +-3 on blue).
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", str(fps), "-c:v", "png", "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-g", str(fps), "-keyint_min", str(fps), "-sc_threshold", "0",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-fps_mode", "cfr", "-movflags", "+faststart", "-an", str(out),
    ]


class Encoder:
    """Feed PNG bytes with write(); a writer thread pipes them to ffmpeg so rendering and encoding overlap."""

    def __init__(self, fps: int, out: Path, crf: int = 18, preset: str = "medium", queue_size: int = 24):
        require_tools()
        self.out = Path(out)
        self._log = tempfile.TemporaryFile()
        self._proc = subprocess.Popen(encode_args(fps, self.out, crf, preset), stdin=subprocess.PIPE,
                                      stdout=subprocess.DEVNULL, stderr=self._log)
        self._q: queue.Queue[bytes | None] = queue.Queue(maxsize=queue_size)
        self._error: str | None = None
        self.blocked_s = 0.0      # time the producer waited on a full queue (ffmpeg is the bottleneck)
        self.finish_s = 0.0       # time spent draining after the last frame
        self._thread = threading.Thread(target=self._pump, daemon=True)
        self._thread.start()

    def _pump(self) -> None:
        assert self._proc.stdin is not None
        try:
            while True:
                item = self._q.get()
                if item is None:
                    break
                self._proc.stdin.write(item)
        except (BrokenPipeError, OSError) as exc:
            self._error = f"pipe to ffmpeg failed: {exc}"

    def write(self, data: bytes) -> None:
        t0 = time.perf_counter()
        while True:
            if self._error or self._proc.poll() is not None:
                raise FfmpegError(self._failure("ffmpeg stopped while frames were still being written"))
            try:
                self._q.put(data, timeout=0.25)
                break
            except queue.Full:
                continue
        self.blocked_s += time.perf_counter() - t0

    def _failure(self, head: str) -> str:
        self._log.seek(0)
        tail = self._log.read().decode("utf-8", "replace").strip()[-1500:]
        return f"{head}: {self._error or ''} {tail}".strip()

    def close(self) -> None:
        t0 = time.perf_counter()
        self._q.put(None)
        self._thread.join()
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
        except OSError:
            pass
        rc = self._proc.wait()
        self.finish_s = time.perf_counter() - t0
        if rc != 0 or self._error:
            raise FfmpegError(self._failure(f"ffmpeg exited with code {rc}"))
        self._log.close()

    def abort(self) -> None:
        try:
            self._proc.kill()
        except OSError:
            pass
        try:
            self._q.put_nowait(None)
        except queue.Full:
            pass
        self._proc.wait()
        self._log.close()
        self.out.unlink(missing_ok=True)

    def __enter__(self) -> "Encoder":
        return self

    def __exit__(self, exc_type: Any, *_: Any) -> None:
        if exc_type is not None:
            self.abort()


def _run(cmd: list[str]) -> bytes:
    require_tools()
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise FfmpegError(f"{cmd[0]} failed: {p.stderr.decode('utf-8', 'replace').strip()[-800:]}")
    return p.stdout


def probe(path: Path) -> dict[str, Any]:
    out = _run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(path)])
    return json.loads(out)


def verify(path: Path, *, width: int, height: int, frames: int, fps: int) -> dict[str, Any]:
    """ffprobe the file: h264, yuv420p, size, exact frame count, fps, bt709 tags, silent. Raises on mismatch."""
    info = probe(path)
    streams = info.get("streams", [])
    video = [s for s in streams if s.get("codec_type") == "video"]
    problems: list[str] = []
    if len(video) != 1:
        raise VerificationError(f"expected exactly one video stream, found {len(video)}")
    v = video[0]
    if len(streams) != 1:
        problems.append(f"expected a silent single-stream file, found {len(streams)} streams")
    checks = {
        "codec": (v.get("codec_name"), "h264"),
        "pix_fmt": (v.get("pix_fmt"), "yuv420p"),
        "width": (v.get("width"), width),
        "height": (v.get("height"), height),
        "frames": (int(v.get("nb_read_frames", -1)), frames),
        "color_space": (v.get("color_space"), "bt709"),
    }
    for name, (got, want) in checks.items():
        if got != want:
            problems.append(f"{name}: expected {want}, got {got}")
    try:
        rate = Fraction(v.get("r_frame_rate", "0/1"))
    except (ValueError, ZeroDivisionError):
        rate = Fraction(0)
    if rate != fps:
        problems.append(f"fps: expected {fps}, got {v.get('r_frame_rate')}")
    if problems:
        raise VerificationError(f"{path.name} failed verification: " + "; ".join(problems))
    return {"codec": v["codec_name"], "pix_fmt": v["pix_fmt"], "width": v["width"], "height": v["height"],
            "frames": frames, "fps": fps, "color_space": v["color_space"], "bytes": Path(path).stat().st_size}


def decode_frame_rgb(path: Path, n: int = 0) -> tuple[int, int, bytes]:
    """Decode frame n as packed RGB24 (for colour tests)."""
    info = probe(path)["streams"][0]
    raw = _run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"select=eq(n\\,{n})", "-vframes", "1",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    return info["width"], info["height"], raw


def frame_md5s(path: Path) -> list[str]:
    """Per-frame MD5 of the decoded video (for byte-identical determinism tests)."""
    out = _run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "framemd5", "-"]).decode()
    return [ln.split(",")[-1].strip() for ln in out.splitlines() if ln and not ln.startswith("#")]


def keyframe_indices(path: Path) -> list[int]:
    out = _run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=flags",
                "-of", "csv=p=0", str(path)]).decode().split()
    return [i for i, flags in enumerate(out) if flags.startswith("K")]
