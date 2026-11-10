"""Visual verification checks C1..C9 for one beat. Report is written for an AI to read."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from .browser import BrowserSession, ContentError, LoadFailure, RenderTimeout, SceneTooLarge
from .spec import BeatSpec

LEVELS = ("fast", "full")
_SEV_RANK = {"error": 0, "warn": 1}
_EVENT_PREFIX = {
    "pageerror": "page error: ",
    "console_error": "console.error: ",
    "request_failed": "",
    "blocked_request": "",
}


def _frame_grid(spec: BeatSpec, step_s: float, include_last: bool) -> list[float]:
    last = spec.frames - 1
    def frame(k: int) -> int:
        return int(k * step_s * spec.fps + 0.5)                  # half-up, same rule as ms_to_frame

    frames = {frame(k) for k in range(int((last / spec.fps) / step_s) + 2) if frame(k) <= last}
    if include_last:
        frames.add(last)
    return [f / spec.fps for f in sorted(frames)]


def _finding(fid: str, severity: str, message: str, t: float | None = None, **data: Any) -> dict[str, Any]:
    return {"id": fid, "severity": severity, "t": t, "message": message, "data": data}


def _event_findings(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for ev in events:
        key = ev["kind"] + re.sub(r"[\d.]+", "#", ev["message"])[:100]
        if key in groups:
            groups[key]["data"]["count"] += 1
        else:
            groups[key] = _finding("C2", "error", _EVENT_PREFIX[ev["kind"]] + ev["message"], kind=ev["kind"], url=ev["url"], count=1)
    return list(groups.values())


def _c8(session: BrowserSession, spec: BeatSpec) -> list[dict[str, Any]]:
    """Determinism: same pixels across two fresh pages, and independent of draw order."""
    if spec.frames < 2:
        return []
    last = spec.frames - 1
    t_a = max(0, min(last, round(spec.frames * 0.25))) / spec.fps
    t_b = max(0, min(last, round(spec.frames * 0.75))) / spec.fps
    if t_a == t_b:
        return []
    bad: dict[float, str] = {}
    try:
        p1 = session.new_page()
        p1.init()
        a1 = p1.ok("pixelHash", t_a)["hash"]
        b1 = p1.ok("pixelHash", t_b)["hash"]
        a1_again = p1.ok("pixelHash", t_a)["hash"]
        p2 = session.new_page()
        p2.init()
        b2 = p2.ok("pixelHash", t_b)["hash"]       # reverse order on a fresh page
        a2 = p2.ok("pixelHash", t_a)["hash"]
    except ContentError:
        return []                                  # a failing draw is already reported by C3 / C2
    if a1 != a1_again:
        bad[t_a] = "redrawing the same t after other draws changed the pixels"
    if a1 != a2:
        bad.setdefault(t_a, "two fresh pages (different draw order) disagree")
    if b1 != b2:
        bad[t_b] = "two fresh pages (different draw order) disagree"
    return [
        _finding("C8", "error", f"draw is not a pure function of t: {why}; look for module-level state or randomness", t)
        for t, why in sorted(bad.items())
    ]


def run_checks(spec: BeatSpec, level: str = "fast", out_dir: Path | None = None,
               session: BrowserSession | None = None, sampling_timeout: float = 120.0) -> dict[str, Any]:
    if level not in LEVELS:
        raise ValueError(f"level must be one of {LEVELS}")
    t_start = time.perf_counter()
    full = level == "full"
    findings: list[dict[str, Any]] = []
    sampling: dict[str, Any] = {}
    timing: dict[str, int] = {}

    def body(s: BrowserSession) -> None:
        page = s.new_page()
        # C1 lint (runs before the scene is loaded, so it also covers scenes that cannot load)
        t0 = time.perf_counter()
        source = Path(spec.scene).read_text(encoding="utf-8", errors="replace")
        findings.extend(page.ok("lint", source)["findings"])
        timing["lint"] = round((time.perf_counter() - t0) * 1000)

        try:
            page.init()
        except LoadFailure as exc:
            explained = any(f["id"] == "C1" and f["message"].startswith(("parse error", "scene must export"))
                            for f in findings)                    # lint already reported this exact cause
            if not explained:
                findings.append(_finding("C2", "error", f"scene failed to load: {exc.message}", stack=exc.stack))
            return
        t0 = time.perf_counter()
        opts = {
            "level": level,
            "c3Times": _frame_grid(spec, 0.5 if full else 1.0, include_last=True),
            "c7Times": _frame_grid(spec, 0.25, include_last=False) if full else [],
            "lastT": (spec.frames - 1) / spec.fps,
            "allowBlankStart": spec.beat.allow_blank_start,
        }
        try:
            res = page.ok("pageChecks", opts, timeout=sampling_timeout)
        except RenderTimeout as exc:
            findings.append(_finding("C3", "error", f"draw never returned: {exc.message}", t=s.last_progress))
            return
        findings.extend(res["findings"])
        sampling.update(res["sampling"])
        sampling["draw_ms"] = res["stats"]["ms"]
        timing["page_checks"] = round((time.perf_counter() - t0) * 1000)
        if full and not any(f["id"] == "C3" for f in res["findings"]):
            t0 = time.perf_counter()
            findings.extend(_c8(s, spec))
            timing["determinism"] = round((time.perf_counter() - t0) * 1000)

    try:
        if session is not None:
            body(session)
            events = list(session.events)
        else:
            with BrowserSession(spec) as s:
                body(s)
                events = list(s.events)
    except SceneTooLarge as exc:
        findings.append(_finding("C2", "error", f"scene rejected before loading: {exc.message}"))
        events = []
    except LoadFailure as exc:
        findings.append(_finding("C2", "error", f"scene failed to load: {exc.message}"))
        events = []
    findings.extend(_event_findings(events))
    for f in findings:
        if f["t"] is not None:
            f["t"] = float(f["t"]) + 0.0          # Playwright sends 0.0 to JS as -0; normalise
    findings.sort(key=lambda f: (_SEV_RANK[f["severity"]], f["id"], f["t"] if f["t"] is not None else -1))
    report = _report(findings, level)
    report["sampling"] = sampling
    report["timing_ms"] = {**timing, "total": round((time.perf_counter() - t_start) * 1000)}
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "report.json").write_text(json.dumps(report, indent=2))
    return report


def _line(f: dict[str, Any]) -> str:
    where = ""
    if f["id"] == "C1" and f["data"].get("line"):
        where = f" L{f['data']['line']}:{f['data']['column']}"
    elif f["t"] is not None:
        where = f" @{f['t']:.2f}s"
    return f"{f['id']} {f['severity']}{where}: {f['message']}"


def _report(findings: list[dict[str, Any]], level: str) -> dict[str, Any]:
    counts = {"error": sum(f["severity"] == "error" for f in findings),
              "warn": sum(f["severity"] == "warn" for f in findings)}
    text = "\n".join(_line(f) for f in findings) if findings else "OK: no findings"
    return {"ok": counts["error"] == 0, "level": level, "counts": counts, "findings": findings, "text": text}
