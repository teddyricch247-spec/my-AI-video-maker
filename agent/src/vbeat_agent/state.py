"""Everything the runner persists in a beat directory (layout: agent/docs/EVENTS.md, extends docs/CONTRACTS.md section 11).

    <beat_dir>/agent/{request.json, state.json, conversation.jsonl, transcript.md, llm_calls.jsonl, events.jsonl, CANCEL, run.lock}
    <beat_dir>/versions/{scene_001.js, scene_001.check.json, scene_001.meta.json, cue_001.py, cue_001.report.json, cue_001.wav, ...}

`scene.js` / `cue.py` always hold the *current* version (a copy, not a symlink).
"""
from __future__ import annotations

import fcntl
import json
import logging
import os
import re
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

from .redact import redact

CONVERSATION_SCHEMA = 1


class SandboxError(ValueError):
    """A path left (or tried to leave) the beat directory."""


class BeatBusy(RuntimeError):
    """Another process is running this beat."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


# ---- atomic file helpers -------------------------------------------------------------------------------------------

def write_text_atomic(path: Path, text: str) -> None:
    text = redact(text)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_json_atomic(path: Path, obj: Any) -> None:
    write_text_atomic(path, json.dumps(obj, indent=1, ensure_ascii=False, default=str) + "\n")


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def copy_atomic(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dst.parent, prefix=f".{dst.name}.", suffix=".tmp")
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        os.replace(tmp, dst)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def append_line(path: Path, line: str, *, fsync: bool = False) -> None:
    line = redact(line)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line if line.endswith("\n") else line + "\n")
        f.flush()
        if fsync:
            os.fsync(f.fileno())


def safe_path(root: Path, candidate: "str | Path") -> Path:
    """Resolve `candidate` against `root` and prove it stays inside. Rejects `..` components, absolute paths outside root
    and symlinks that escape (the check is on the resolved real path)."""
    root_r = Path(root).resolve()
    p = Path(candidate)
    if ".." in p.parts:
        raise SandboxError(f"path {str(candidate)!r} contains '..'")
    full = p if p.is_absolute() else root_r / p
    resolved = full.resolve()
    if resolved != root_r and root_r not in resolved.parents:
        raise SandboxError(f"path {str(candidate)!r} resolves outside the beat directory")
    return resolved


class BeatPaths:
    """All the paths of one beat directory, in one place."""

    def __init__(self, beat_dir: "str | Path"):
        self.dir = Path(beat_dir).resolve()
        self.agent = self.dir / "agent"
        self.versions = self.dir / "versions"
        self.request = self.agent / "request.json"
        self.state = self.agent / "state.json"
        self.conversation = self.agent / "conversation.jsonl"
        self.transcript_md = self.agent / "transcript.md"
        self.llm_calls = self.agent / "llm_calls.jsonl"
        self.events = self.agent / "events.jsonl"
        self.cancel = self.agent / "CANCEL"
        self.lock = self.agent / "run.lock"
        self.system_prompt = self.agent / "system_prompt.md"
        self.scene = self.dir / "scene.js"
        self.cue = self.dir / "cue.py"
        self.spec = self.dir / "spec.json"
        self.transcript = self.dir / "transcript.json"
        self.markers = self.dir / "markers.json"
        self.strip = self.dir / "strip.jpg"
        self.report = self.dir / "report.json"
        self.video = self.dir / "video.mp4"
        self.final = self.dir / "final.mp4"
        self.pipeline = self.dir / "pipeline.json"
        self.sfx = self.dir / "sfx"
        self.sfx_spec = self.sfx / "spec.json"
        self.preview = self.versions / "preview"

    def ensure(self) -> "BeatPaths":
        for d in (self.dir, self.agent, self.versions):
            d.mkdir(parents=True, exist_ok=True)
        return self

    def scene_version(self, n: int) -> Path:
        return self.versions / f"scene_{n:03d}.js"

    def scene_check(self, n: int) -> Path:
        return self.versions / f"scene_{n:03d}.check.json"

    def scene_meta(self, n: int) -> Path:
        return self.versions / f"scene_{n:03d}.meta.json"

    def scene_strip(self, n: int) -> Path:
        return self.versions / f"scene_{n:03d}.strip.jpg"

    def cue_version(self, n: int) -> Path:
        return self.versions / f"cue_{n:03d}.py"

    def cue_report(self, n: int) -> Path:
        return self.versions / f"cue_{n:03d}.report.json"

    def cue_meta(self, n: int) -> Path:
        return self.versions / f"cue_{n:03d}.meta.json"

    def cue_wav(self, n: int) -> Path:
        return self.versions / f"cue_{n:03d}.wav"

    def cue_preview(self, n: int) -> Path:
        return self.versions / f"cue_{n:03d}.preview.jpg"

    def rel(self, p: "str | Path") -> str:
        """Beat-relative path for events and the conversation (never an absolute path of this machine)."""
        try:
            return str(Path(p).resolve().relative_to(self.dir))
        except ValueError:
            return str(p)

    def safe(self, candidate: "str | Path") -> Path:
        return safe_path(self.dir, candidate)


# ---- the per-beat lock -----------------------------------------------------------------------------------------------

class BeatLock:
    """flock on agent/run.lock for the duration of a run: two processes must not drive one beat directory."""

    def __init__(self, paths: BeatPaths):
        self.paths, self._fd = paths, None

    def acquire(self) -> None:
        self.paths.agent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.paths.lock, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise BeatBusy(f"another process is running {self.paths.dir}") from None
        os.ftruncate(fd, 0)
        os.write(fd, str(os.getpid()).encode())
        self._fd = fd

    def release(self) -> None:
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            finally:
                os.close(self._fd)
                self._fd = None

    def __enter__(self) -> "BeatLock":
        self.acquire()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.release()

    @staticmethod
    def is_locked(paths: BeatPaths) -> bool:
        if not paths.lock.exists():
            return False
        fd = os.open(paths.lock, os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        else:
            fcntl.flock(fd, fcntl.LOCK_UN)
            return False
        finally:
            os.close(fd)


# ---- state.json -------------------------------------------------------------------------------------------------------

DEFAULT_STATE: dict[str, Any] = {
    "status": "created", "status_reason": None, "summary": None, "question": None,
    "steps": 0, "cost_usd": 0.0, "wall_s": 0.0, "unknown_cost_calls": 0, "runs": 0,
    "caps": None, "scene_n": None, "sfx_n": None, "markers_n": None, "full_ok_n": None,
    "final_video": None, "final_stale": False, "last_report": None, "model": None,
    "restored_best": None, "started_at": None, "updated_at": None, "pid": None,
}


class StateStore:
    """state.json: written atomically after every turn so a killed process can resume."""

    def __init__(self, paths: BeatPaths):
        self.paths = paths
        self.on_write: Callable[[dict[str, Any]], None] | None = None     # a Mirror's `state`: called after every write (never raises)

    def _notify(self, d: dict[str, Any]) -> None:
        if self.on_write is not None:
            try:
                self.on_write(dict(d))
            except Exception:  # noqa: BLE001
                logging.getLogger("vbeat_agent.state").exception("state mirror hook failed")

    def load(self) -> dict[str, Any]:
        d = dict(DEFAULT_STATE)
        d.update(read_json(self.paths.state, {}) or {})
        return d

    def update(self, **kw: Any) -> dict[str, Any]:
        d = self.load()
        d.update(kw)
        d["updated_at"] = now_iso()
        write_json_atomic(self.paths.state, d)
        self._notify(d)
        return d

    def add(self, *, steps: int = 0, cost_usd: float = 0.0, wall_s: float = 0.0, unknown_cost_calls: int = 0) -> dict[str, Any]:
        d = self.load()
        d["steps"] += steps
        d["cost_usd"] = round(d["cost_usd"] + cost_usd, 6)
        d["wall_s"] = round(d["wall_s"] + wall_s, 3)
        d["unknown_cost_calls"] += unknown_cost_calls
        d["updated_at"] = now_iso()
        write_json_atomic(self.paths.state, d)
        self._notify(d)
        return d


# ---- conversation.jsonl -----------------------------------------------------------------------------------------------

class ConversationStore:
    """Every message, in order, one JSON object per line. The exact messages sent to and received from the model, plus an
    underscore-prefixed `_meta` key (stripped before sending) that makes context compaction reproducible on resume."""

    def __init__(self, paths: BeatPaths):
        self.paths = paths
        self.on_append: Callable[[dict[str, Any]], None] | None = None   # a Mirror's `message`: called after the line is on disk

    def append(self, message: dict[str, Any]) -> None:
        line = redact(json.dumps(message, ensure_ascii=False, default=str))      # what is on disk is what a mirror sees
        append_line(self.paths.conversation, line, fsync=True)
        if self.on_append is not None:
            try:
                self.on_append(json.loads(line))
            except Exception:  # noqa: BLE001 - the disk has it; a mirror problem never stops a run
                logging.getLogger("vbeat_agent.state").exception("conversation mirror hook failed")

    def load(self) -> list[dict[str, Any]]:
        """All complete lines; a last line cut off by a kill is ignored (and removed so appends stay well-formed)."""
        p = self.paths.conversation
        if not p.exists():
            return []
        raw = p.read_text(encoding="utf-8")
        out: list[dict[str, Any]] = []
        good_len = 0
        for line in raw.splitlines(keepends=True):
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                break
            good_len += len(line.encode("utf-8"))
        if good_len < len(raw.encode("utf-8")):
            with open(p, "r+b") as f:
                f.truncate(good_len)
        return out


def strip_internal(message: dict[str, Any]) -> dict[str, Any]:
    """The message as the API should see it: no `_`-prefixed keys."""
    return {k: v for k, v in message.items() if not k.startswith("_")}


def repair_dangling_tool_calls(messages: list[dict[str, Any]], note: str) -> list[dict[str, Any]]:
    """After a kill mid-turn the last assistant message may have tool_calls without all their tool results. Returns the
    synthetic tool messages (one per missing id, in call order) that make the conversation valid again; caller appends them."""
    last_assistant = None
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant":
            last_assistant = i
            break
    if last_assistant is None:
        return []
    calls = messages[last_assistant].get("tool_calls") or []
    answered = {m.get("tool_call_id") for m in messages[last_assistant + 1:] if m.get("role") == "tool"}
    out = []
    for c in calls:
        if c.get("id") not in answered:
            body = {"ok": False, "kind": "tool_fault", "error": note}
            out.append({"role": "tool", "tool_call_id": c.get("id"), "content": json.dumps(body, ensure_ascii=False),
                        "_meta": {"name": (c.get("function") or {}).get("name", "?"), "ok": False, "summary": "[interrupted]"}})
    return out


# ---- versions ---------------------------------------------------------------------------------------------------------

_VERSION_RE = {"scene": re.compile(r"^scene_(\d{3,})\.js$"), "cue": re.compile(r"^cue_(\d{3,})\.py$")}


def check_projection_safe(rep: dict[str, Any] | None) -> dict[str, Any] | None:
    """The web API's `Check` ({ok, counts, text}) from a report, tolerant of None."""
    if not rep:
        return None
    return {"ok": bool(rep.get("ok")), "counts": {"error": int(rep["counts"]["error"]), "warn": int(rep["counts"]["warn"])},
            "text": str(rep.get("text", ""))}


class VersionStore:
    """Numbered scene and cue versions. `n` matches SceneVersion.n / SfxVersion.n in frontend/docs/API_CONTRACT.md."""

    def __init__(self, paths: BeatPaths, state: StateStore):
        self.paths, self.state = paths, state

    # numbering comes from the files on disk, so a crash between "file written" and "state updated" never reuses a number
    def latest_n(self, kind: str) -> int:
        n = 0
        if self.paths.versions.exists():
            for p in self.paths.versions.iterdir():
                m = _VERSION_RE[kind].match(p.name)
                if m:
                    n = max(n, int(m.group(1)))
        return n

    def numbers(self, kind: str) -> list[int]:
        out = []
        if self.paths.versions.exists():
            for p in self.paths.versions.iterdir():
                m = _VERSION_RE[kind].match(p.name)
                if m:
                    out.append(int(m.group(1)))
        return sorted(out)

    def current_n(self, kind: str) -> int | None:
        return self.state.load()["scene_n" if kind == "scene" else "sfx_n"]

    def _file(self, kind: str, n: int) -> Path:
        return self.paths.scene_version(n) if kind == "scene" else self.paths.cue_version(n)

    def source(self, kind: str, n: int) -> str:
        return self._file(kind, n).read_text(encoding="utf-8")

    def current_source(self, kind: str) -> str | None:
        n = self.current_n(kind)
        return self.source(kind, n) if n else None

    def save(self, kind: str, source: str, *, note: str = "", step: int = 0) -> tuple[int, bool]:
        """Save a new version and make it current. Returns (n, reused). Identical source to the current version whose check
        did not finish (a tool fault) reuses that version, so retrying a faulted write does not burn a version number."""
        cur = self.current_n(kind)
        if cur and self._file(kind, cur).exists() and self.source(kind, cur) == source and not self.has_result(kind, cur):
            self._activate(kind, cur)
            return cur, True
        n = self.latest_n(kind) + 1
        self._file(kind, n).write_text(source, encoding="utf-8")
        meta = {"n": n, "created_at": now_iso(), "created_by": "agent", "note": note, "bytes": len(source.encode("utf-8")), "step": step}
        write_json_atomic(self.paths.scene_meta(n) if kind == "scene" else self.paths.cue_meta(n), meta)
        self._activate(kind, n)
        return n, False

    def _activate(self, kind: str, n: int) -> None:
        dst = self.paths.scene if kind == "scene" else self.paths.cue
        copy_atomic(self._file(kind, n), dst)
        self.state.update(**{"scene_n" if kind == "scene" else "sfx_n": n})

    def set_current(self, kind: str, n: int) -> None:
        if n not in self.numbers(kind):
            raise KeyError(f"no {kind} version {n}; existing: {self.numbers(kind)}")
        self._activate(kind, n)

    def has_result(self, kind: str, n: int) -> bool:
        return (self.paths.scene_check(n) if kind == "scene" else self.paths.cue_report(n)).exists()

    def save_scene_check(self, n: int, report: dict[str, Any]) -> None:
        write_json_atomic(self.paths.scene_check(n), report)

    def save_cue_report(self, n: int, report: dict[str, Any], metrics: dict[str, Any] | None = None) -> None:
        write_json_atomic(self.paths.cue_report(n), {**report, "metrics": metrics})

    def scene_report(self, n: int) -> dict[str, Any] | None:
        return read_json(self.paths.scene_check(n))

    def cue_report(self, n: int) -> dict[str, Any] | None:
        return read_json(self.paths.cue_report(n))

    # ---- API-shaped listings (frontend/docs/API_CONTRACT.md SceneVersion / SfxVersion; URLs are beat-relative paths) ----
    def list_scene_versions(self) -> list[dict[str, Any]]:
        cur = self.current_n("scene")
        out = []
        for n in self.numbers("scene"):
            meta = read_json(self.paths.scene_meta(n), {}) or {}
            strip = self.paths.scene_strip(n)
            out.append({"n": n, "created_at": meta.get("created_at"), "created_by": "agent",
                        "strip_url": self.paths.rel(strip) if strip.exists() else None,
                        "checks": check_projection_safe(self.scene_report(n)), "is_current": n == cur})
        return out

    def list_sfx_versions(self) -> list[dict[str, Any]]:
        cur = self.current_n("cue")
        out = []
        for n in self.numbers("cue"):
            meta = read_json(self.paths.cue_meta(n), {}) or {}
            wav, prev = self.paths.cue_wav(n), self.paths.cue_preview(n)
            out.append({"n": n, "created_at": meta.get("created_at"),
                        "wav_url": self.paths.rel(wav) if wav.exists() else None,
                        "spectrogram_url": self.paths.rel(prev) if prev.exists() else None,
                        "checks": check_projection_safe(self.cue_report(n)), "is_current": n == cur})
        return out

    # ---- "best version" for runs that stop without finishing ----
    def _quality(self, kind: str, n: int) -> tuple | None:
        rep = self.scene_report(n) if kind == "scene" else self.cue_report(n)
        if not rep or "counts" not in rep:
            return None
        full = 0 if rep.get("level") == "full" else 1          # a full check is better evidence than a fast one
        return (rep["counts"]["error"], full, rep["counts"]["warn"], -n)

    def best_n(self, kind: str) -> int | None:
        scored = [(q, n) for n in self.numbers(kind) if (q := self._quality(kind, n)) is not None]
        return min(scored)[1] if scored else None
