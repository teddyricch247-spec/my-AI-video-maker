"""A scripted fake model: a TEST DOUBLE. It lives under agent/tests and is not part of the product (no CLI flag, no config): tests inject it
through run_beat(..., llm=...) to exercise the whole system without spending credits.

Script format (JSON):

    {"turns": [
        {"text": "optional prose", "tool_calls": [{"name": "get_beat_info", "arguments": {}}],
         "usage": {"prompt_tokens": 1200, "completion_tokens": 300, "cost": 0.002}, "delay_s": 0.0},
        {"raise": "rate_limited" | "unavailable" | "auth" | "bad_request"},
        {"raw_tool_calls": [{"name": "write_scene", "arguments": "{not json"}]}
     ],
     "supports_images": true}

Anywhere inside `arguments`, `{"$file": "scene_v1.js"}` is replaced by that file's text (path relative to the script), so scene
and cue sources live in real files. When the script runs out the fake calls `give_up`, so a demo ends cleanly.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from vbeat_agent.llm_types import (ChatResult, LLMAuthError, LLMBadRequest, LLMRateLimited, LLMUnavailable, ModelInfo, Usage, parse_tool_calls)

_RAISES = {"rate_limited": LLMRateLimited, "unavailable": LLMUnavailable, "auth": LLMAuthError, "bad_request": LLMBadRequest}


def _expand(obj: Any, base: Path) -> Any:
    if isinstance(obj, dict):
        if set(obj) == {"$file"}:
            return (base / obj["$file"]).read_text(encoding="utf-8")
        return {k: _expand(v, base) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand(v, base) for v in obj]
    return obj


class FakeLLM:
    def __init__(self, script: dict[str, Any] | list[dict[str, Any]], base_dir: Path | None = None, *, default_delay_s: float = 0.0):
        if isinstance(script, list):
            script = {"turns": script}
        self.base = Path(base_dir) if base_dir else Path.cwd()
        self.turns: list[dict[str, Any]] = list(script.get("turns", []))
        self.supports_images = bool(script.get("supports_images", True))
        self.default_delay_s = float(script.get("delay_s", default_delay_s))
        self.pos = 0
        self.calls: list[dict[str, Any]] = []         # every request received (messages, tools), for assertions

    @classmethod
    def from_file(cls, path: "str | Path", **kw: Any) -> "FakeLLM":
        p = Path(path)
        return cls(json.loads(p.read_text(encoding="utf-8")), p.parent, **kw)

    def clone(self) -> "FakeLLM":
        """A fresh fake at the start of the same script (one per beat when several beats share a script)."""
        c = FakeLLM({"turns": self.turns, "supports_images": self.supports_images, "delay_s": self.default_delay_s}, self.base)
        return c

    async def model_info(self, model: str) -> ModelInfo:
        return ModelInfo(id=model, name="fake", supports_tools=True, supports_images=self.supports_images, price_in=0.0, price_out=0.0)

    async def chat(self, *, model: str, messages: list[dict], tools: list[dict] | None = None,
                   temperature: float | None = None, max_tokens: int | None = None) -> ChatResult:
        self.calls.append({"model": model, "messages": messages, "tools": tools})
        i = self.pos
        self.pos += 1
        if i >= len(self.turns):
            turn: dict[str, Any] = {"tool_calls": [{"name": "give_up", "arguments": {"reason": "fake script exhausted"}}]}
        else:
            turn = self.turns[i]
        delay = float(turn.get("delay_s", self.default_delay_s))
        if delay:
            await asyncio.sleep(delay)
        if "raise" in turn:
            raise _RAISES[turn["raise"]](turn.get("message", f"fake {turn['raise']}"), status=turn.get("status"))
        raw: list[dict[str, Any]] = []
        for j, c in enumerate(turn.get("tool_calls", [])):
            args = _expand(c.get("arguments", {}), self.base)
            raw.append({"id": c.get("id") or f"call_{i + 1}_{j}", "type": "function",
                        "function": {"name": c["name"], "arguments": json.dumps(args, ensure_ascii=False)}})
        for j, c in enumerate(turn.get("raw_tool_calls", [])):
            a = c.get("arguments", "")
            raw.append({"id": c.get("id") or f"call_{i + 1}_r{j}", "type": "function",
                        "function": {"name": c["name"], "arguments": a if isinstance(a, str) else json.dumps(a)}})
        msg: dict[str, Any] = {"role": "assistant", "content": turn.get("text") or None}
        if raw:
            msg["tool_calls"] = raw
        u = turn.get("usage", {})
        usage = Usage(prompt_tokens=int(u.get("prompt_tokens", 1000)), completion_tokens=int(u.get("completion_tokens", 200)),
                      cost_usd=u.get("cost", 0.0) if "cost" in u or "cost_unknown" not in u else None, cost_source="fake")
        if u.get("cost_unknown"):
            usage.cost_usd, usage.cost_source = None, "unknown"
        finish = turn.get("finish_reason") or ("tool_calls" if raw else "stop")
        return ChatResult(message=msg, tool_calls=parse_tool_calls(raw, finish_reason=finish), finish_reason=finish, usage=usage,
                          model=model, attempts=1, latency_ms=round(delay * 1000))
