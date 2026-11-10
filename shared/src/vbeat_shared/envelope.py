"""JSON envelope and check-report shapes shared by every command-line tool (docs/CONTRACTS.md sections 2 and 6).

Every vbeat command prints exactly ONE line of JSON on stdout:

    {"ok", "command", "artifacts": {name: path}, "report": obj|null, "timing_ms": {...}, "error": null | {"type", "message", ...}}

Exit codes are NOT uniform across the tools (they were frozen separately: see docs/MERGE_DECISIONS.md D3).
Callers must therefore read the envelope, never the exit code alone: use `classify`.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Mapping

ENVELOPE_KEYS = ("ok", "command", "artifacts", "report", "timing_ms", "error")
CHECK_SEVERITIES = ("error", "warn", "info")
# error.type values that mean "the beat (scene or cue script) is broken, the tool is fine".
CONTENT_ERROR_TYPES = frozenset({"SceneError", "LoadError", "MarkerError", "SceneTooLarge", "RenderTimeout", "ContentError"})
# Check-id prefixes. A letter belongs to exactly one tool; new tools take a new letter and add it here.
CHECK_ID_PREFIXES = {"C": "vbeat_sprite visual checks", "A": "vbeat_audio checks"}


class Outcome(str, Enum):
    PASS = "pass"                    # the tool ran and (if it has a report) the report passed
    REPORT_FAILED = "report_failed"  # the tool ran, the report has an error finding
    CONTENT_FAULT = "content_fault"  # the tool ran but the scene/cue is broken (ok:false with a content error type)
    TOOL_FAILED = "tool_failed"      # the tool itself failed (bad input, missing external tool, verification failure, ...)


def error_obj(type_: str, message: str, **extra: Any) -> dict:
    return {"type": type_, "message": message, **extra}


def make_envelope(command: str, *, ok: bool = True, artifacts: Mapping[str, str] | None = None, report: Any = None,
                  timing_ms: Mapping[str, Any] | None = None, error: Mapping[str, Any] | None = None) -> dict:
    return {"ok": bool(ok), "command": command, "artifacts": dict(artifacts or {}), "report": report,
            "timing_ms": dict(timing_ms or {}), "error": dict(error) if error else None}


def validate_envelope(env: Any) -> list[str]:
    """Problems with an envelope, empty when it is well formed."""
    if not isinstance(env, dict):
        return ["envelope is not an object"]
    out = [f"missing key '{k}'" for k in ENVELOPE_KEYS if k not in env]
    out += [f"unexpected key '{k}'" for k in env if k not in ENVELOPE_KEYS]
    if out:
        return out
    if not isinstance(env["ok"], bool):
        out.append("'ok' must be a boolean")
    if not isinstance(env["command"], str) or not env["command"]:
        out.append("'command' must be a non-empty string")
    if not isinstance(env["artifacts"], dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env["artifacts"].items()):
        out.append("'artifacts' must map names to path strings")
    if not isinstance(env["timing_ms"], dict):
        out.append("'timing_ms' must be an object")
    err = env["error"]
    if env["ok"] and err is not None:
        out.append("'error' must be null when ok is true")
    if not env["ok"] and not (isinstance(err, dict) and isinstance(err.get("type"), str) and isinstance(err.get("message"), str)):
        out.append("'error' must be {type, message} when ok is false")
    if env["report"] is not None and not isinstance(env["report"], dict):
        out.append("'report' must be an object or null")
    return out


def validate_check_report(rep: Any) -> list[str]:
    """Problems with a check report (docs/CONTRACTS.md section 6). Extra keys (level, sampling, timing_ms, ...) are allowed."""
    if not isinstance(rep, dict):
        return ["report is not an object"]
    out: list[str] = []
    for k in ("ok", "counts", "findings", "text"):
        if k not in rep:
            out.append(f"missing key '{k}'")
    if out:
        return out
    counts = rep["counts"]
    if not (isinstance(counts, dict) and isinstance(counts.get("error"), int) and isinstance(counts.get("warn"), int)):
        out.append("'counts' must be {error:int, warn:int}")
    if not isinstance(rep["findings"], list):
        return out + ["'findings' must be a list"]
    n_err = n_warn = 0
    for i, f in enumerate(rep["findings"]):
        if not isinstance(f, dict) or not {"id", "severity", "message"} <= set(f):
            out.append(f"findings[{i}] needs id, severity, message")
            continue
        if f["severity"] not in CHECK_SEVERITIES:
            out.append(f"findings[{i}] severity '{f['severity']}' not in {CHECK_SEVERITIES}")
        if not (isinstance(f["id"], str) and len(f["id"]) >= 2 and f["id"][0] in CHECK_ID_PREFIXES and f["id"][1:].isdigit()):
            out.append(f"findings[{i}] id '{f['id']}' must be one of the prefixes {sorted(CHECK_ID_PREFIXES)} followed by digits")
        n_err += f["severity"] == "error"
        n_warn += f["severity"] == "warn"
    if isinstance(counts, dict) and (counts.get("error"), counts.get("warn")) != (n_err, n_warn):
        out.append(f"counts {counts} disagree with the findings ({n_err} errors, {n_warn} warnings)")
    if isinstance(rep["ok"], bool) and rep["ok"] != (n_err == 0):
        out.append("'ok' must be true exactly when there are no error findings")
    if not isinstance(rep["text"], str):
        out.append("'text' must be a string")
    return out


def check_projection(rep: Mapping[str, Any]) -> dict:
    """The web API's `Check` object ({ok, counts:{error,warn}, text}) from a full check report."""
    return {"ok": bool(rep["ok"]), "counts": {"error": int(rep["counts"]["error"]), "warn": int(rep["counts"]["warn"])}, "text": str(rep["text"])}


def classify(env: Mapping[str, Any]) -> Outcome:
    """Interpret an envelope independent of the tool's exit code."""
    if not env.get("ok"):
        err = env.get("error") or {}
        return Outcome.CONTENT_FAULT if err.get("type") in CONTENT_ERROR_TYPES else Outcome.TOOL_FAILED
    rep = env.get("report")
    if isinstance(rep, dict) and rep.get("ok") is False:
        return Outcome.REPORT_FAILED
    return Outcome.PASS
