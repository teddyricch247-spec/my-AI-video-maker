"""The OpenRouter client: chat completions with tool calling, the model catalogue, the key/credit check.

Transport is the standard library (urllib in a worker thread): the one place in the repo that talks to the network needs no
third-party dependency.  The key is sent in one header and is never logged, persisted or put in an exception message.

What it guarantees to the loop:
- every failure is one of the typed errors in llm_types (auth / rate-limited / unavailable / bad-request / model-not-supported),
  with "HTTP <status>" and the API's own explanation in the message (redacted, truncated);
- transient trouble (429, 408, 5xx, dropped connections, an error object inside a 200 body, an unparseable body, an empty
  `choices`) is retried with exponential backoff + jitter, honouring Retry-After, up to `settings.max_attempts`;
- malformed tool-call arguments are NOT an exception: they come back flagged on the ToolCall so the model can be told;
- cost: `usage.cost` from the API when present, else tokens x catalogue price, else unknown (the budget then charges an estimate).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from .config import Settings
from .llm_types import (ChatResult, LLMAuthError, LLMBadRequest, LLMError, LLMRateLimited, LLMUnavailable, ModelInfo, ModelNotSupported, Usage,
                        parse_tool_calls)
from .redact import RedactingFilter, redact, register_secret

log = logging.getLogger("vbeat_agent.openrouter")
log.addFilter(RedactingFilter())

CATALOGUE_TTL_S = 24 * 3600
MAX_RETRY_AFTER_S = 60.0
_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


# ---- transport -------------------------------------------------------------------------------------------------------------

class Response:
    __slots__ = ("status", "headers", "body")

    def __init__(self, status: int, headers: dict[str, str], body: bytes):
        self.status, self.headers, self.body = status, headers, body


def _http(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> Response:
    """One blocking HTTP exchange. Returns error statuses as Responses; raises OSError-family errors for network trouble."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    host = urllib.parse.urlparse(url).hostname or ""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if host in _LOOPBACK else urllib.request.build_opener()
    try:
        with opener.open(req, timeout=timeout) as r:
            return Response(r.status, {k.lower(): v for k, v in r.headers.items()}, r.read())
    except urllib.error.HTTPError as e:
        try:
            data = e.read()
        except Exception:  # noqa: BLE001
            data = b""
        return Response(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, data)


# ---- error mapping ---------------------------------------------------------------------------------------------------------

def _api_message(body: Any, raw: bytes = b"") -> str:
    msg = ""
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or "")
            meta = err.get("metadata")
            if isinstance(meta, dict):
                raw_meta = meta.get("raw")
                prov = meta.get("provider_name")
                extra = (f" [{prov}]" if prov else "") + (f" {raw_meta}" if isinstance(raw_meta, str) and raw_meta not in msg else "")
                msg += extra
        elif isinstance(err, str):
            msg = err
        elif isinstance(body.get("message"), str):
            msg = body["message"]
    if not msg and raw:
        msg = raw[:300].decode("utf-8", "replace")
    return redact(" ".join(msg.split()))[:400]


def classify_error(status: int, message: str, body: Any = None) -> LLMError:
    """Map an HTTP status (or a body-level error code) and the API's message to a typed error."""
    text = f"HTTP {status}: {message}" if message else f"HTTP {status}"
    low = message.lower()
    if status in (401, 402, 403):
        return LLMAuthError(text, status=status, body=body)
    if status == 404 and ("tool" in low or "endpoints" in low or "function" in low):
        return ModelNotSupported(text, status=status, body=body)
    if status in (408, 409, 425, 429) or status >= 500:
        return (LLMRateLimited if status == 429 else LLMUnavailable)(text, status=status, body=body)
    return LLMBadRequest(text, status=status, body=body)


def _body_error(data: Any) -> tuple[int, str] | None:
    """An error object inside a 200 response (OpenRouter does this when a provider fails mid-request)."""
    err = data.get("error") if isinstance(data, dict) else None
    if err is None and isinstance(data, dict):
        ch = (data.get("choices") or [None])[0]
        if isinstance(ch, dict) and ch.get("error"):
            err = ch["error"]
    if not err:
        return None
    code: Any = err.get("code") if isinstance(err, dict) else None
    try:
        status = int(code)
    except (TypeError, ValueError):
        status = 502
    return status, _api_message({"error": err})


def _retry_after(headers: dict[str, str]) -> float | None:
    v = headers.get("retry-after")
    if not v:
        return None
    try:
        return max(0.0, min(MAX_RETRY_AFTER_S, float(v)))
    except ValueError:
        return None


# ---- the client ------------------------------------------------------------------------------------------------------------

def _model_info(entry: dict[str, Any]) -> ModelInfo:
    arch = entry.get("architecture") or {}
    pricing = entry.get("pricing") or {}

    def per_m(v: Any) -> float | None:
        try:
            return round(float(v) * 1_000_000, 6)
        except (TypeError, ValueError):
            return None
    params = entry.get("supported_parameters")
    return ModelInfo(id=str(entry.get("id", "")), name=str(entry.get("name") or entry.get("id", "")),
                     supports_tools=("tools" in params) if isinstance(params, list) else True,
                     supports_images="image" in (arch.get("input_modalities") or []),
                     price_in=per_m(pricing.get("prompt")), price_out=per_m(pricing.get("completion")),
                     context_length=entry.get("context_length") if isinstance(entry.get("context_length"), int) else None)


class OpenRouterClient:
    def __init__(self, settings: Settings, *, http: Callable[..., Response] | None = None, sleep: Callable[[float], Any] | None = None,
                 rng: random.Random | None = None):
        self.s = settings
        self._key = settings.api_key
        register_secret(self._key)
        self._http = http or _http
        self._sleep = sleep or asyncio.sleep
        self._rng = rng or random.Random()
        self._catalogue: dict[str, ModelInfo] | None = None

    @classmethod
    def from_settings(cls, settings: Settings, **kw: Any) -> "OpenRouterClient":
        return cls(settings, **kw)

    # ---- plumbing ----
    def _headers(self, *, auth: bool, json_body: bool) -> dict[str, str]:
        h = {"Accept": "application/json", "User-Agent": "vbeat-agent", "HTTP-Referer": self.s.referer, "X-Title": self.s.title}
        if json_body:
            h["Content-Type"] = "application/json"
        if auth and self._key:
            h["Authorization"] = f"Bearer {self._key}"
        return h

    def _url(self, path: str) -> str:
        return self.s.base_url.rstrip("/") + "/" + path.lstrip("/")

    async def _exchange(self, method: str, path: str, body: dict | None, *, auth: bool, timeout: float) -> Response:
        data = json.dumps(body).encode() if body is not None else None
        try:
            return await asyncio.to_thread(self._http, method, self._url(path), self._headers(auth=auth, json_body=body is not None), data, timeout)
        except TimeoutError as exc:
            raise LLMUnavailable(f"no answer within {timeout:g} s ({exc.__class__.__name__})") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            reason = getattr(exc, "reason", exc)
            raise LLMUnavailable(f"could not reach {urllib.parse.urlparse(self._url(path)).netloc}: {redact(str(reason))[:200]}") from None

    # ---- chat ----
    def _payload(self, model: str, messages: list[dict], tools: list[dict] | None, temperature: float | None, max_tokens: int | None) -> dict[str, Any]:
        wire = [{k: v for k, v in m.items() if not k.startswith("_")} for m in messages]
        p: dict[str, Any] = {"model": model, "messages": wire}
        if tools:
            p["tools"] = tools
            p["tool_choice"] = "auto"
        if temperature is not None:
            p["temperature"] = temperature
        if max_tokens:
            p["max_tokens"] = max_tokens
        if self.s.send_usage_flag:
            p["usage"] = {"include": True}
        provider = dict(self.s.provider) if self.s.provider else ({"require_parameters": True} if tools else None)
        if provider:
            p["provider"] = provider
        if self.s.models_fallback:
            p["models"] = list(self.s.models_fallback)
        return p

    async def chat(self, *, model: str, messages: list[dict], tools: list[dict] | None = None, temperature: float | None = None,
                   max_tokens: int | None = None) -> ChatResult:
        if not self._key:
            raise LLMAuthError("HTTP 401: no API key is set (OPENROUTER_API_KEY)", status=401)
        payload = self._payload(model, messages, tools, temperature, max_tokens)
        started = time.monotonic()
        last: LLMError | None = None
        for attempt in range(1, max(1, self.s.max_attempts) + 1):
            wait: float | None = None
            try:
                resp = await self._exchange("POST", "chat/completions", payload, auth=True, timeout=self.s.request_timeout)
                result = self._parse(resp, model)
            except LLMError as exc:
                last = exc
                if not exc.retryable or attempt >= self.s.max_attempts:
                    self._log(model, attempt, started, error=exc)
                    raise
                wait = getattr(exc, "retry_after", None)
            else:
                result.attempts = attempt
                result.latency_ms = int((time.monotonic() - started) * 1000)
                self._log(model, attempt, started, result=result)
                return result
            delay = wait if wait is not None else min(30.0, 2.0 ** (attempt - 1)) * self._rng.uniform(0.5, 1.0)
            log.info(json.dumps({"event": "openrouter_retry", "model": model, "attempt": attempt, "wait_s": round(delay, 2), "error": str(last)[:160]}))
            await self._sleep(delay)
        raise last or LLMUnavailable("no attempts were made")   # pragma: no cover

    def _parse(self, resp: Response, model: str) -> ChatResult:
        raw = resp.body or b""
        try:
            data = json.loads(raw) if raw.strip() else None
        except ValueError:
            data = None
        if resp.status != 200:
            err = classify_error(resp.status, _api_message(data, raw), data)
            ra = _retry_after(resp.headers)
            if ra is not None:
                err.retry_after = ra          # type: ignore[attr-defined]
            raise err
        if not isinstance(data, dict):
            raise LLMUnavailable(f"HTTP 200 but the body was not JSON: {redact(raw[:120].decode('utf-8', 'replace'))!r}", status=200)
        be = _body_error(data)
        if be:
            raise classify_error(be[0], be[1], data)
        choices = data.get("choices")
        if not choices or not isinstance(choices[0], dict) or not isinstance(choices[0].get("message"), dict):
            raise LLMUnavailable("HTTP 200 but the response had no choices", status=200, body=data)
        ch = choices[0]
        msg = ch["message"]
        finish = ch.get("native_finish_reason") if ch.get("finish_reason") is None else ch.get("finish_reason")
        calls = parse_tool_calls(msg.get("tool_calls"), finish_reason=finish)
        content = msg.get("content")
        assistant: dict[str, Any] = {"role": "assistant", "content": content if (content or not msg.get("tool_calls")) else None}
        if msg.get("tool_calls"):
            assistant["tool_calls"] = [{"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.raw_arguments or "{}"}} for c in calls]
        if msg.get("reasoning_details"):
            assistant["reasoning_details"] = msg["reasoning_details"]     # some models require their reasoning handed back unchanged
        used = data.get("usage") or {}
        pt, ct = int(used.get("prompt_tokens") or 0), int(used.get("completion_tokens") or 0)
        cost, source = None, "unknown"
        if isinstance(used.get("cost"), (int, float)):
            cost, source = float(used["cost"]), "api"
        else:
            info = (self._catalogue or {}).get(model)
            if info and info.price_in is not None and info.price_out is not None and (pt or ct):
                cost, source = (pt * info.price_in + ct * info.price_out) / 1_000_000, "catalogue"
        return ChatResult(message=assistant, tool_calls=calls, finish_reason=finish, model=str(data.get("model") or model),
                          usage=Usage(prompt_tokens=pt, completion_tokens=ct, cost_usd=cost, cost_source=source,
                                      unknown_estimate_usd=self.s.unknown_call_cost_usd), request_id=data.get("id"))

    def _log(self, model: str, attempts: int, started: float, *, result: ChatResult | None = None, error: LLMError | None = None) -> None:
        rec: dict[str, Any] = {"event": "openrouter_call", "model": model, "attempts": attempts, "latency_ms": int((time.monotonic() - started) * 1000)}
        if result:
            rec.update(ok=True, prompt_tokens=result.usage.prompt_tokens, completion_tokens=result.usage.completion_tokens,
                       cost_usd=result.usage.cost_usd, cost_source=result.usage.cost_source, finish_reason=result.finish_reason)
        if error:
            rec.update(ok=False, status=error.status, error=str(error)[:200])
        log.info(json.dumps(rec))

    # ---- catalogue ----
    def _cache_path(self) -> Path:
        return Path(self.s.cache_dir) / "openrouter-models.json"

    def _read_cache(self, *, ignore_age: bool = False) -> list[dict] | None:
        p = self._cache_path()
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            if ignore_age or time.time() - float(doc["fetched_at"]) < CATALOGUE_TTL_S:
                return list(doc["data"])
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return None

    def _write_cache(self, data: list[dict]) -> None:
        p = self._cache_path()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            import fcntl
            with open(p.parent / ".models.lock", "w") as lk:
                fcntl.flock(lk, fcntl.LOCK_EX)
                fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".models-")
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump({"fetched_at": time.time(), "data": data}, f)
                os.replace(tmp, p)
        except OSError as exc:                       # a cache that cannot be written only costs one more fetch
            log.info(json.dumps({"event": "catalogue_cache_unwritable", "error": str(exc)[:120]}))

    async def list_models(self, *, refresh: bool = False) -> list[ModelInfo]:
        """The model catalogue (public endpoint, no key sent). Cached on disk for 24 h; a stale cache is used if the fetch fails."""
        entries = None if refresh else self._read_cache()
        if entries is None:
            try:
                resp = await self._exchange("GET", "models", None, auth=False, timeout=min(60.0, self.s.request_timeout))
                data = json.loads(resp.body or b"{}") if resp.status == 200 else None
                if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                    raise LLMUnavailable(f"HTTP {resp.status}: the model list could not be read", status=resp.status)
                entries = data["data"]
                self._write_cache(entries)
            except (LLMError, ValueError):
                entries = self._read_cache(ignore_age=True)
                if entries is None:
                    raise
        infos = [_model_info(e) for e in entries if isinstance(e, dict) and e.get("id")]
        self._catalogue = {m.id: m for m in infos}
        return infos

    async def model_info(self, model: str) -> ModelInfo | None:
        """The catalogue entry for `model`, or None when it is not listed or the catalogue cannot be fetched (the run proceeds)."""
        if self._catalogue is None:
            try:
                await self.list_models()
            except LLMError:
                return None
        return (self._catalogue or {}).get(model)

    # ---- key / credits (used by preflight) ----
    async def key_status(self) -> dict[str, Any]:
        """GET /key: the key's limit and usage. Never returns the key or its label. Raises LLMAuthError for a bad key."""
        if not self._key:
            raise LLMAuthError("HTTP 401: no API key is set (OPENROUTER_API_KEY)", status=401)
        resp = await self._exchange("GET", "key", None, auth=True, timeout=30.0)
        try:
            data = json.loads(resp.body or b"{}")
        except ValueError:
            data = None
        if resp.status != 200:
            raise classify_error(resp.status, _api_message(data, resp.body), data)
        d = (data or {}).get("data") or {}
        num = lambda v: float(v) if isinstance(v, (int, float)) else None   # noqa: E731
        return {"limit": num(d.get("limit")), "usage": num(d.get("usage")), "limit_remaining": num(d.get("limit_remaining")),
                "is_free_tier": bool(d.get("is_free_tier"))}
