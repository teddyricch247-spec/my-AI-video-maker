"""The generic ReAct loop. Tool-agnostic: a future Director can reuse it with its own tools and prompt.

    run_loop(llm, model, system, messages, tools, caps, hooks, ...) -> LoopResult

Each turn: check cancel and caps, compact the context if needed, call the model, append the assistant message, execute every
tool call (consecutive read-only calls concurrently, everything else sequentially in the order given), append one `tool`
message per call. A tool never raises into the loop: every failure becomes a result `{"ok": false, "error", "kind"}`.
`tool_fault` (the infrastructure broke) is retried once before the model sees it; if it persists the run ends `failed`.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import time
import traceback
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol

from .config import Caps
from .context import prepare_messages
from .llm_types import (LLM, LLMAuthError, LLMBadRequest, LLMError, LLMRateLimited, LLMUnavailable, ModelNotSupported, ToolCall)
from .toolrun import Cancelled, CancelSignal, ToolFault

log = logging.getLogger("vbeat_agent.loop")

RESULT_CAP_BYTES = 4096
MAX_NUDGES = 2
STUCK_IDENTICAL = 3
STUCK_STRIKES_TO_STOP = 3
NUDGE_TEXT = ("Continue by calling a tool. If you are finished call `finish`; if you need the user call `ask_user`; "
              "if you cannot proceed call `give_up`.")


class ModelFault(Exception):
    """Raised by a tool handler for input the model got wrong: the message goes back to the model verbatim."""


# ---- tools --------------------------------------------------------------------------------------------------------------

@dataclass
class EndSignal:
    """A terminal tool (finish, ask_user, give_up) ends the loop with this."""
    status: str                      # waiting_user | needs_attention
    reason: str | None = None
    summary: str | None = None
    question: str | None = None


@dataclass
class ToolOutcome:
    ok: bool
    text: str = ""                   # what the model sees (truncated to RESULT_CAP_BYTES by the loop)
    kind: str | None = None          # model_fault | tool_fault when not ok
    summary: str = ""                # one line, for events and for compaction
    images: list[Path] = field(default_factory=list)
    end: EndSignal | None = None
    signature: str | None = None     # fingerprint of a check report, for "alternating states" detection
    report_kind: str | None = None   # scene | cue | finish: results kept in full by compaction (the latest of each)
    data: dict[str, Any] = field(default_factory=dict)   # extra JSON fields in the tool message (n, counts, ...)
    image_paths: list[str] = field(default_factory=list)  # beat-relative, for the tool_result event

    @staticmethod
    def fault(text: str, kind: str = "model_fault", summary: str = "") -> "ToolOutcome":
        return ToolOutcome(False, text, kind=kind, summary=summary or text[:120])


Handler = Callable[[dict[str, Any]], Awaitable[ToolOutcome]]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Handler
    read_only: bool = False

    def schema(self) -> dict[str, Any]:
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


class ToolRegistry:
    def __init__(self, tools: list[Tool] | None = None):
        self._tools: dict[str, Tool] = {}
        for t in tools or []:
            self.add(t)

    def add(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"duplicate tool {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return list(self._tools)

    def schemas(self) -> list[dict[str, Any]]:
        return [t.schema() for t in self._tools.values()]


def validate_args(schema: dict[str, Any], args: dict[str, Any]) -> list[str]:
    """A small JSON-schema subset (object, required, properties, type, enum, items, additionalProperties=false) so every tool
    gets precise, model-readable argument errors without writing its own."""
    problems: list[str] = []
    props = schema.get("properties", {})
    for r in schema.get("required", []):
        if r not in args:
            problems.append(f"missing required argument '{r}'")
    if schema.get("additionalProperties") is False:
        for k in args:
            if k not in props:
                problems.append(f"unknown argument '{k}' (allowed: {sorted(props)})")
    for k, v in args.items():
        sp = props.get(k)
        if sp is not None:
            problems += _check_value(k, sp, v)
    return problems


def _check_value(name: str, sp: dict[str, Any], v: Any) -> list[str]:
    t = sp.get("type")
    kinds = {"string": str, "boolean": bool, "array": list, "object": dict}
    if v is None and sp.get("nullable"):
        return []
    if t == "integer":
        ok = isinstance(v, int) and not isinstance(v, bool)
    elif t == "number":
        ok = isinstance(v, (int, float)) and not isinstance(v, bool)
    elif t in kinds:
        ok = isinstance(v, kinds[t])
    else:
        ok = True
    if not ok:
        return [f"argument '{name}' must be {t}, got {type(v).__name__}"]
    if "enum" in sp and v not in sp["enum"]:
        return [f"argument '{name}' must be one of {sp['enum']}, got {v!r}"]
    out: list[str] = []
    if t == "array":
        if "maxItems" in sp and len(v) > sp["maxItems"]:
            out.append(f"argument '{name}' has {len(v)} items; at most {sp['maxItems']}")
        for i, item in enumerate(v):
            out += _check_value(f"{name}[{i}]", sp.get("items", {}), item)
    if t in ("integer", "number"):
        if "minimum" in sp and v < sp["minimum"]:
            out.append(f"argument '{name}' must be >= {sp['minimum']}")
        if "maximum" in sp and v > sp["maximum"]:
            out.append(f"argument '{name}' must be <= {sp['maximum']}")
    return out


# ---- hooks, results, stores ---------------------------------------------------------------------------------------------

@dataclass
class Hooks:
    """Callbacks for events. Each may be sync or async; an exception in one is logged and ignored."""
    on_turn_start: Callable[[int], Any] | None = None                              # (step)
    on_llm_call: Callable[[dict[str, Any]], Any] | None = None                     # (info)
    on_message: Callable[[int, dict[str, Any]], Any] | None = None                 # (step, message)
    on_tool_start: Callable[[int, ToolCall], Any] | None = None                    # (step, call)
    on_tool_result: Callable[[int, ToolCall, ToolOutcome, int], Any] | None = None  # (step, call, outcome, wall_ms)
    on_status: Callable[[str, str | None], Any] | None = None                      # (status, reason)


class Store(Protocol):
    """Persistence the loop calls synchronously after every message / call / turn. Unlike hooks, failures here propagate."""
    def append_message(self, message: dict[str, Any]) -> None: ...
    def log_llm_call(self, record: dict[str, Any]) -> None: ...
    def checkpoint(self, info: dict[str, Any]) -> None: ...


class Budget(Protocol):
    """A budget shared by several loops (runner.SharedBudget). `reserve` returns a token or None when the budget is spent."""
    def reserve(self, estimate: float) -> Any | None: ...
    def settle(self, token: Any, actual: float) -> None: ...


@dataclass
class LoopResult:
    status: str                      # waiting_user | needs_attention | failed | cancelled
    reason: str | None
    steps: int
    cost_usd: float
    unknown_cost_calls: int
    wall_s: float
    end: EndSignal | None
    messages: list[dict[str, Any]]
    caps: dict[str, Any]
    stuck_warned: bool = False
    fault_detail: str | None = None


async def _hook(fn: Callable[..., Any] | None, *args: Any) -> None:
    if fn is None:
        return
    try:
        r = fn(*args)
        if inspect.isawaitable(r):
            await r
    except Exception:  # noqa: BLE001 - a hook can never break the loop
        log.exception("hook %s failed", getattr(fn, "__name__", fn))


def _digest(obj: Any) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _cap_text(text: str, cap: int = RESULT_CAP_BYTES) -> str:
    b = text.encode("utf-8")
    if len(b) <= cap:
        return text
    return b[:cap].decode("utf-8", "ignore") + f"\n[truncated: result was {len(b)} bytes, showing the first {cap}]"


def tool_message(call: ToolCall, outcome: ToolOutcome) -> dict[str, Any]:
    body: dict[str, Any] = {"ok": outcome.ok}
    if outcome.ok:
        body["text"] = _cap_text(outcome.text)
    else:
        body["error"] = _cap_text(outcome.text)
        body["kind"] = outcome.kind or "model_fault"
    body.update(outcome.data)
    meta = {"name": call.name, "ok": outcome.ok, "summary": outcome.summary}
    if outcome.report_kind:
        meta["report_kind"] = outcome.report_kind
    return {"role": "tool", "tool_call_id": call.id, "content": json.dumps(body, ensure_ascii=False), "_meta": meta}


def _skipped(call: ToolCall, why: str) -> dict[str, Any]:
    return tool_message(call, ToolOutcome(False, f"skipped: {why}", kind="model_fault", summary=f"[{call.name}: skipped]"))


class _Run:
    """The state of one run_loop invocation."""

    def __init__(self, llm: LLM, model: str, system: str, messages: list[dict[str, Any]], tools: ToolRegistry, caps: Caps,
                 hooks: Hooks, cancel: CancelSignal | None, store: Store | None, budget: Budget | None,
                 media_root: Path | None, temperature: float | None, max_tokens: int | None, unknown_call_cost: float,
                 clock: Callable[[], float]):
        self.llm, self.model, self.system, self.messages, self.tools, self.caps = llm, model, system, messages, tools, caps
        self.hooks, self.cancel, self.store, self.budget = hooks, cancel, store, budget
        self.media_root, self.temperature, self.max_tokens, self.unknown_call_cost = media_root, temperature, max_tokens, unknown_call_cost
        self.clock = clock
        self.t0 = clock()
        self.steps = 0
        self.cost = 0.0
        self.unknown_calls = 0
        self.errors_in_a_row = 0
        self.nudges = 0
        self.stuck_warned = False
        self.stuck_strikes = 0
        self.recent_calls: deque[str] = deque(maxlen=STUCK_IDENTICAL)
        self.signatures: list[str] = []
        self.last_text = ""

    # -- helpers --
    def append(self, message: dict[str, Any]) -> None:
        self.messages.append(message)
        if self.store:
            self.store.append_message(message)

    def result(self, status: str, reason: str | None, end: EndSignal | None = None, detail: str | None = None) -> LoopResult:
        return LoopResult(status=status, reason=reason, steps=self.steps, cost_usd=round(self.cost, 6),
                          unknown_cost_calls=self.unknown_calls, wall_s=round(self.clock() - self.t0, 3), end=end,
                          messages=self.messages, caps=self.caps.to_dict(), stuck_warned=self.stuck_warned, fault_detail=detail)

    def cap_hit(self) -> str | None:
        c = self.caps
        if self.steps >= c.max_steps:
            return "cap:max_steps"
        if (self.clock() - self.t0) >= c.max_minutes * 60:
            return "cap:max_minutes"
        # stop before a call whose typical cost would cross the cap, not after: the cap is a promise about spending
        avg = (self.cost / self.steps) if self.steps else 0.0
        if self.cost >= c.max_usd or self.cost + avg > c.max_usd:
            return "cap:max_usd"
        if self.errors_in_a_row >= c.max_tool_errors_in_a_row:
            return "cap:max_tool_errors_in_a_row"
        return None

    def cancelled(self) -> str | None:
        return self.cancel.why() if self.cancel is not None and self.cancel.is_set() else None

    # -- tool execution --
    async def exec_call(self, call: ToolCall) -> tuple[ToolOutcome, int]:
        t0 = self.clock()
        tool = self.tools.get(call.name)
        if tool is None:
            return ToolOutcome.fault(f"Unknown tool '{call.name}'. Available tools: {', '.join(self.tools.names())}",
                                     summary=f"[{call.name}: unknown tool]"), 0
        if call.invalid_arguments:
            return ToolOutcome.fault(f"{call.error} Resend the call with a valid JSON object.", summary=f"[{call.name}: bad arguments]"), 0
        problems = validate_args(tool.parameters, call.arguments)
        if problems:
            return ToolOutcome.fault("Invalid arguments: " + "; ".join(problems), summary=f"[{call.name}: invalid arguments]"), 0
        await _hook(self.hooks.on_tool_start, self.steps, call)
        outcome: ToolOutcome | None = None
        for attempt in (1, 2):
            try:
                outcome = await tool.handler(call.arguments)
            except Cancelled:
                raise
            except ModelFault as exc:
                outcome = ToolOutcome.fault(str(exc), summary=f"[{call.name}: {str(exc)[:80]}]")
            except ToolFault as exc:
                outcome = ToolOutcome.fault(f"{exc}" + (f"\n{exc.detail}" if exc.detail else ""), kind="tool_fault",
                                            summary=f"[{call.name}: tool fault]")
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - never raise into the loop
                log.error("tool %s crashed: %s\n%s", call.name, exc, traceback.format_exc())
                outcome = ToolOutcome.fault(f"internal error in {call.name}: {type(exc).__name__}: {exc}", kind="tool_fault",
                                            summary=f"[{call.name}: internal error]")
            if outcome.ok or outcome.kind != "tool_fault" or attempt == 2:
                break
            log.warning("tool %s failed with a tool fault, retrying once: %s", call.name, outcome.text[:200])
        assert outcome is not None
        wall = round((self.clock() - t0) * 1000)
        return outcome, wall

    async def exec_turn(self, calls: list[ToolCall]) -> tuple[list[tuple[ToolCall, ToolOutcome, int]], str | None, bool]:
        """Run the turn's calls. Returns (results, stop_reason, ended). Every call gets a result, executed or skipped."""
        done: list[tuple[ToolCall, ToolOutcome, int]] = []
        i, n = 0, len(calls)
        stop: str | None = None
        ended = False
        while i < n:
            if stop is None and (r := self.cancelled()):
                stop = f"cancelled:{r}"
            if stop is not None or ended:
                why = ("the run was cancelled" if stop.startswith("cancelled") else "an earlier tool call failed") if stop else "the run already ended"
                for c in calls[i:]:
                    self.append(_skipped(c, why))
                    done.append((c, ToolOutcome(False, f"skipped: {why}", kind="model_fault"), 0))
                break
            call = calls[i]
            tool = self.tools.get(call.name)
            group = [call]
            if tool is not None and tool.read_only and not call.invalid_arguments:
                j = i + 1
                while j < n and (t2 := self.tools.get(calls[j].name)) is not None and t2.read_only and not calls[j].invalid_arguments:
                    group.append(calls[j])
                    j += 1
            try:
                if len(group) > 1:
                    results = await asyncio.gather(*[self.exec_call(c) for c in group])
                else:
                    results = [await self.exec_call(call)]
            except Cancelled as exc:
                self.append(tool_message(call, ToolOutcome(False, f"interrupted: {exc.reason}", kind="tool_fault", summary=f"[{call.name}: interrupted]")))
                done.append((call, ToolOutcome(False, "interrupted", kind="tool_fault"), 0))
                stop = f"cancelled:{exc.reason}"
                i += 1
                continue
            for c, (outcome, wall) in zip(group, results):
                self.append(tool_message(c, outcome))
                await _hook(self.hooks.on_tool_result, self.steps, c, outcome, wall)
                done.append((c, outcome, wall))
                if outcome.end is not None and outcome.ok:
                    ended = True
                if not outcome.ok and outcome.kind == "tool_fault" and stop is None and not ended:
                    stop = "tool_fault"
                if stop == "tool_fault" or ended:
                    # remaining calls of this group (already executed) keep their results; later calls are skipped above
                    pass
            i += len(group)
        return done, stop, ended

    def detect_stuck(self, results: list[tuple[ToolCall, ToolOutcome, int]]) -> str | None:
        for c, outcome, _ in results:
            self.recent_calls.append(f"{c.name}:{_digest(c.arguments)}")
            if outcome.signature:
                self.signatures.append(outcome.signature)
        if len(self.recent_calls) == STUCK_IDENTICAL and len(set(self.recent_calls)) == 1:
            name = results[-1][0].name
            return f"you made the same `{name}` call with identical arguments {STUCK_IDENTICAL} times in a row"
        s = self.signatures
        if len(s) >= 3 and s[-1] == s[-2] == s[-3]:
            return "the last 3 attempts produced the same findings"
        if len(s) >= 4 and s[-1] == s[-3] and s[-2] == s[-4] and s[-1] != s[-2]:
            return "you are alternating between two states with identical findings"
        return None


async def _chat_or_cancel(coro: Awaitable[Any], run: "_Run") -> Any:
    """Await the model call, but watch the cancel signal and the kill switch every second: a long request must not make a
    kill switch wait up to the request timeout. On cancel the request task is dropped."""
    task = asyncio.ensure_future(coro)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=1.0)
            if done:
                return task.result()
            why = run.cancelled()
            if why:
                raise Cancelled(why)
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:  # noqa: BLE001 - the dropped request's outcome is irrelevant
                pass


async def run_loop(llm: LLM, model: str, system: str, messages: list[dict[str, Any]], tools: ToolRegistry, caps: Caps,
                   hooks: Hooks | None = None, *, cancel: "CancelSignal | asyncio.Event | None" = None,
                   sentinel: Path | None = None, store: Store | None = None, budget: Budget | None = None,
                   media_root: Path | None = None, temperature: float | None = None, max_tokens: int | None = None,
                   unknown_call_cost: float = 0.05, inflight_estimate: float = 0.02,
                   clock: Callable[[], float] = time.monotonic) -> LoopResult:
    """Run the loop until a terminal tool, a cap, a failure or cancellation. `messages` (user/assistant/tool history, without
    the system prompt) is extended in place and returned in the result. See the module docstring."""
    hooks = hooks or Hooks()
    sig = CancelSignal.wrap(cancel, sentinel) if (cancel is not None or sentinel is not None) else None
    run = _Run(llm, model, system, messages, tools, caps, hooks, sig, store, budget, media_root, temperature, max_tokens,
               unknown_call_cost, clock)
    await _hook(hooks.on_status, "running", None)
    schemas = tools.schemas()
    while True:
        why = run.cancelled()
        if why:
            return run.result("cancelled", why)
        cap = run.cap_hit()
        if cap:
            return run.result("needs_attention", cap)
        prep = prepare_messages(run.messages, budget=caps.context_budget, system=system, media_root=media_root)
        if prep.hopeless:
            return run.result("needs_attention", "cap:context",
                              detail=f"context is about {prep.tokens_after} tokens after compaction; budget {caps.context_budget}")
        token = None
        if budget is not None:
            avg = (run.cost / run.steps) if run.steps else 0.0
            token = budget.reserve(max(inflight_estimate, avg))
            if token is None:
                return run.result("needs_attention", getattr(budget, "denial_reason", "cap:total_max_usd"))
        step = run.steps + 1
        await _hook(hooks.on_turn_start, step)
        try:
            res = await _chat_or_cancel(llm.chat(model=model, messages=[{"role": "system", "content": system}] + prep.messages,
                                                 tools=schemas, temperature=temperature, max_tokens=max_tokens), run)
        except Cancelled as exc:
            # the request may still be billed: charge the reservation's estimate instead of nothing
            est = max(inflight_estimate, (run.cost / run.steps) if run.steps else 0.0)
            if budget is not None:
                budget.settle(token, est)
            run.cost += est
            return run.result("cancelled", exc.reason)
        except LLMAuthError as exc:
            if budget is not None:
                budget.settle(token, 0.0)
            return run.result("failed", "llm_auth", detail=str(exc))
        except ModelNotSupported as exc:
            if budget is not None:
                budget.settle(token, 0.0)
            return run.result("failed", "model_not_supported", detail=str(exc))
        except LLMBadRequest as exc:
            if budget is not None:
                budget.settle(token, 0.0)
            return run.result("failed", "llm_bad_request", detail=str(exc))
        except (LLMRateLimited, LLMUnavailable) as exc:
            if budget is not None:
                budget.settle(token, 0.0)
            return run.result("failed", "llm_unavailable", detail=str(exc))
        except asyncio.CancelledError:
            if budget is not None:
                budget.settle(token, 0.0)
            raise
        except LLMError as exc:
            if budget is not None:
                budget.settle(token, 0.0)
            return run.result("failed", "llm_error", detail=str(exc))
        except Exception as exc:  # noqa: BLE001
            if budget is not None:
                budget.settle(token, 0.0)
            log.error("unexpected error from the model client: %s\n%s", exc, traceback.format_exc())
            return run.result("failed", "llm_error", detail=f"{type(exc).__name__}: {exc}")
        run.steps = step
        spent = res.usage.budget_cost()
        run.cost += spent
        run.unknown_calls += 1 if res.usage.unknown_cost else 0
        if budget is not None:
            budget.settle(token, spent)
        info = {"step": step, "model": res.model or model, "attempts": res.attempts, "latency_ms": res.latency_ms,
                "prompt_tokens": res.usage.prompt_tokens, "completion_tokens": res.usage.completion_tokens,
                "cost_usd": res.usage.cost_usd, "cost_source": res.usage.cost_source, "budget_cost_usd": round(spent, 6),
                "finish_reason": res.finish_reason, "context_tokens_est": prep.tokens_after, "elided": prep.elided,
                "run_cost_usd": round(run.cost, 6)}
        if store:
            store.log_llm_call(info)
        await _hook(hooks.on_llm_call, info)
        run.append(res.message)
        await _hook(hooks.on_message, step, res.message)
        if store:
            store.checkpoint({"steps": run.steps, "cost_usd": run.cost, "wall_s": clock() - run.t0,
                              "unknown_cost_calls": run.unknown_calls})
        if not res.tool_calls:
            run.last_text = res.text
            if run.nudges >= MAX_NUDGES:
                return run.result("needs_attention", "no_tool_call")
            run.nudges += 1
            run.append({"role": "user", "content": NUDGE_TEXT, "_meta": {"kind": "nudge"}})
            continue
        run.nudges = 0
        results, stop, ended = await run.exec_turn(res.tool_calls)
        for _, outcome, _ in results:
            run.errors_in_a_row = 0 if outcome.ok else run.errors_in_a_row + 1
        images = [p for _, o, _ in results for p in o.images]
        if images:
            paths = [str(p) for p in images][-4:]
            run.append({"role": "user", "_meta": {"kind": "images"}, "content":
                        [{"type": "text", "text": "Preview images from your last `preview` call, in the order requested:"}] +
                        [{"type": "image_file", "path": p} for p in paths]})
        end = next((o.end for _, o, _ in results if o.end is not None and o.ok), None)
        if store:
            store.checkpoint({"steps": run.steps, "cost_usd": run.cost, "wall_s": clock() - run.t0,
                              "unknown_cost_calls": run.unknown_calls})
        if end is not None:
            return run.result(end.status, end.reason, end)
        faulted = next(((c, o) for c, o, _ in results if not o.ok and o.kind == "tool_fault"), None)
        if faulted is not None and stop == "tool_fault":
            return run.result("failed", f"tool_fault:{faulted[0].name}", detail=faulted[1].text)
        if stop and stop.startswith("cancelled:"):
            return run.result("cancelled", stop.split(":", 1)[1])
        stuck = run.detect_stuck(results)
        if stuck:
            if not run.stuck_warned:
                run.stuck_warned = True
                last = next((o.text for _, o, _ in reversed(results) if o.text), "")
                run.append({"role": "user", "_meta": {"kind": "stuck"},
                            "content": f"You are repeating yourself: {stuck}. Last findings:\n{_cap_text(last, 800)}\n"
                                       "Change approach (read the findings again, look at a preview, try a different asset) or call `give_up`."})
            else:
                run.stuck_strikes += 1
                run.errors_in_a_row += 1
                if run.stuck_strikes >= STUCK_STRIKES_TO_STOP:
                    return run.result("needs_attention", "stuck")
