"""Types shared by the real OpenRouter client, the scripted fake model and the loop (they all speak ChatResult)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol


class LLMError(Exception):
    """Base of every error an LLM client raises. `retryable` says whether trying the same request again can help."""
    retryable = False

    def __init__(self, message: str, *, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status, self.body = status, body


class LLMRateLimited(LLMError):
    retryable = True


class LLMUnavailable(LLMError):
    retryable = True


class LLMBadRequest(LLMError):
    """4xx other than 408/429. Never retried. The message carries the API's own explanation."""


class LLMAuthError(LLMError):
    """401/402/403. Stops a whole run: 402 means out of credits, 401 a bad key."""


class ModelNotSupported(LLMError):
    """The model cannot do tool calling (or is unknown in a way that makes the run pointless)."""


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float | None = None          # actual or computed cost; None when neither the API nor the catalogue knows
    cost_source: str = "unknown"           # api | catalogue | unknown | fake
    unknown_estimate_usd: float = 0.05     # what an unknown-cost call is charged against the budget

    def budget_cost(self) -> float:
        return float(self.cost_usd) if self.cost_usd is not None else float(self.unknown_estimate_usd)

    @property
    def unknown_cost(self) -> bool:
        return self.cost_usd is None

    def to_dict(self) -> dict[str, Any]:
        return {"prompt_tokens": self.prompt_tokens, "completion_tokens": self.completion_tokens, "cost_usd": self.cost_usd,
                "cost_source": self.cost_source, "unknown_cost": self.unknown_cost}


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str = ""
    error: str | None = None               # set when `arguments` was not parseable (flag: invalid_arguments)

    @property
    def invalid_arguments(self) -> bool:
        return self.error is not None


@dataclass
class ChatResult:
    message: dict[str, Any]                # the assistant message to append to the conversation (OpenAI shape)
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    attempts: int = 1
    latency_ms: int = 0
    request_id: str | None = None

    @property
    def text(self) -> str:
        c = self.message.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            return "".join(p.get("text", "") for p in c if isinstance(p, dict))
        return ""


class LLM(Protocol):
    """What the loop needs from a model client. `OpenRouterClient` and `FakeLLM` both implement it."""

    async def chat(self, *, model: str, messages: list[dict], tools: list[dict] | None = None,
                   temperature: float | None = None, max_tokens: int | None = None) -> ChatResult: ...

    async def model_info(self, model: str) -> "ModelInfo | None": ...


@dataclass
class ModelInfo:
    id: str
    name: str = ""
    supports_tools: bool = True
    supports_images: bool = False
    price_in: float | None = None          # USD per 1M tokens (matches ModelInfo in frontend/docs/API_CONTRACT.md)
    price_out: float | None = None
    context_length: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "supports_tools": self.supports_tools, "supports_images": self.supports_images,
                "price_in": self.price_in, "price_out": self.price_out}


def parse_tool_calls(raw_calls: list[dict] | None, *, finish_reason: str | None = None) -> list[ToolCall]:
    """OpenAI-shape `tool_calls` -> ToolCall objects. Unparseable arguments are flagged, never raised."""
    out: list[ToolCall] = []
    for i, c in enumerate(raw_calls or []):
        fn = (c or {}).get("function") or {}
        raw = fn.get("arguments")
        raw_s = raw if isinstance(raw, str) else json.dumps(raw if raw is not None else {})
        call = ToolCall(id=str(c.get("id") or f"call_{i}"), name=str(fn.get("name") or ""), arguments={}, raw_arguments=raw_s)
        if isinstance(raw, dict):
            call.arguments = raw
        elif not raw_s.strip():
            call.arguments = {}
        else:
            try:
                val = json.loads(raw_s)
            except json.JSONDecodeError as exc:
                hint = " The response was cut off at the output limit; write something shorter." if finish_reason == "length" else ""
                call.error = f"arguments are not valid JSON ({exc.msg} at char {exc.pos}).{hint}"
            else:
                if isinstance(val, dict):
                    call.arguments = val
                else:
                    call.error = f"arguments must be a JSON object, got {type(val).__name__}"
        out.append(call)
    return out
