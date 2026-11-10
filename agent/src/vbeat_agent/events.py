"""Events: what a run emits (schema: agent/docs/EVENTS.md) and the adapter to the web API's `Message` shape."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol, runtime_checkable

from .state import append_line, now_iso


@runtime_checkable
class EventSink(Protocol):
    def emit(self, event: dict[str, Any]) -> None: ...


class NullSink:
    def emit(self, event: dict[str, Any]) -> None:
        pass


class FileEventSink:
    """Appends every event to events.jsonl. Always on."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()

    def emit(self, event: dict[str, Any]) -> None:
        with self._lock:
            append_line(self.path, json.dumps(event, ensure_ascii=False, default=str))


class CallbackSink:
    """Calls `fn(event)`. An exception in the callback is logged and swallowed: a sink can never break a run."""

    def __init__(self, fn: Callable[[dict[str, Any]], Any]):
        self.fn = fn

    def emit(self, event: dict[str, Any]) -> None:
        try:
            self.fn(event)
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger("vbeat_agent.events").exception("event callback failed")


class ListSink:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)


class MultiSink:
    def __init__(self, *sinks: EventSink | None):
        self.sinks = [s for s in sinks if s is not None]

    def emit(self, event: dict[str, Any]) -> None:
        for s in self.sinks:
            try:
                s.emit(event)
            except Exception:  # noqa: BLE001
                import logging
                logging.getLogger("vbeat_agent.events").exception("event sink failed")


EVENT_TYPES = ("run_started", "user_message", "llm_call", "assistant_message", "tool_call", "tool_result", "scene_version",
               "sfx_version", "status", "cost", "note", "run_finished")


class Emitter:
    """Stamps `type, ts, beat_idx, step` on every event and fans it out. `step` is the LLM turn (0 outside a turn)."""

    def __init__(self, sink: EventSink, beat_idx: int):
        self.sink, self.beat_idx, self.step = sink, beat_idx, 0

    def __call__(self, type_: str, **fields: Any) -> dict[str, Any]:
        ev = {"type": type_, "ts": now_iso(), "beat_idx": self.beat_idx, "step": self.step, **fields}
        self.sink.emit(ev)
        return ev


# ---- events -> web API Message objects ------------------------------------------------------------------------------

def events_to_messages(events: Iterable[dict[str, Any]], *, url_for: Callable[[str], str] | None = None,
                       start_seq: int = 1) -> list[dict[str, Any]]:
    """Convert a run's events into `Message` objects (frontend/docs/API_CONTRACT.md):
    {seq, role: user|assistant|event, text, steps:[{name, summary, ok, image_urls}], created_at, queued}.

    - `user_message`            -> role "user"
    - `assistant_message` plus the `tool_call`/`tool_result` events of the same step -> one role "assistant" Message whose
      `steps` are the tool calls (a step with no prose gets text "")
    - `scene_version`, `sfx_version`, `status`, `note`, `run_started`, `run_finished` -> role "event" with a one-line text
    - `llm_call` and `cost` are bookkeeping and produce nothing.
    `url_for` maps a beat-relative image path to a URL (the backend supplies it); default: the path itself."""
    url_for = url_for or (lambda p: p)
    out: list[dict[str, Any]] = []
    pending: dict[str, Any] | None = None       # the assistant message of the current step, collecting steps
    pending_calls: dict[str, dict[str, Any]] = {}

    def flush() -> None:
        nonlocal pending, pending_calls
        if pending is not None:
            out.append(pending)
        pending, pending_calls = None, {}

    def new_msg(role: str, text: str, ts: str, steps: list | None = None) -> dict[str, Any]:
        return {"role": role, "text": text, "steps": steps or [], "created_at": ts, "queued": False}

    for ev in events:
        t, ts = ev.get("type"), ev.get("ts", "")
        if t == "user_message":
            flush()
            out.append(new_msg("user", ev.get("text", ""), ts))
        elif t == "assistant_message":
            flush()
            pending = new_msg("assistant", ev.get("text") or "", ts)
            pending["_step"] = ev.get("step")
        elif t == "tool_call":
            if pending is None or pending.get("_step") != ev.get("step"):
                flush()
                pending = new_msg("assistant", "", ts)
                pending["_step"] = ev.get("step")
            step = {"name": ev.get("name", ""), "summary": ev.get("args_summary", ""), "ok": True, "image_urls": []}
            pending["steps"].append(step)
            if ev.get("call_id"):
                pending_calls[ev["call_id"]] = step
        elif t == "tool_result":
            step = pending_calls.get(ev.get("call_id"))
            if step is None:
                if pending is None or pending.get("_step") != ev.get("step"):
                    flush()
                    pending = new_msg("assistant", "", ts)
                    pending["_step"] = ev.get("step")
                step = {"name": ev.get("name", ""), "summary": "", "ok": True, "image_urls": []}
                pending["steps"].append(step)
            step["summary"] = ev.get("summary") or step["summary"]
            step["ok"] = bool(ev.get("ok", True))
            step["image_urls"] = [url_for(p) for p in ev.get("image_paths") or []]
        elif t in ("scene_version", "sfx_version"):
            flush()
            kind = "Scene" if t == "scene_version" else "Sound"
            c = ev.get("checks") or {}
            text = f"{kind} v{ev.get('n')} saved: {c.get('error', 0)} errors, {c.get('warn', 0)} warnings"
            out.append(new_msg("event", text, ts))
        elif t == "status":
            flush()
            reason = f" ({ev['reason']})" if ev.get("reason") else ""
            out.append(new_msg("event", f"Status: {ev.get('status')}{reason}", ts))
        elif t == "note":
            flush()
            out.append(new_msg("event", ev.get("text", ""), ts))
        elif t == "run_started":
            flush()
            out.append(new_msg("event", f"Run started (model {ev.get('model')})", ts))
        elif t == "run_finished":
            flush()
            r = ev.get("result") or {}
            text = f"Run finished: {r.get('status')}"
            if r.get("status_reason"):
                text += f" ({r['status_reason']})"
            if r.get("summary"):
                text += f". {r['summary']}"
            out.append(new_msg("event", text, ts))
    flush()
    for i, m in enumerate(out, start_seq):
        m.pop("_step", None)
        m["seq"] = i
    return out
