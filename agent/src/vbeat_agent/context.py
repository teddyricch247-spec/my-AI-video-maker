"""Context management for the loop: deterministic compaction and image handling. Pure functions of (messages, budget).

Messages are in the internal shape (OpenAI chat messages plus an optional `_meta` dict that is stripped before sending):

    assistant   {"role": "assistant", "content": ..., "tool_calls": [{"id", "type": "function", "function": {"name", "arguments"}}]}
    tool        {"role": "tool", "tool_call_id", "content": <json string>, "_meta": {"name", "ok", "summary", "report_kind"?}}
    user+images {"role": "user", "content": [{"type": "text", ...}, {"type": "image_file", "path": <beat-relative>}], "_meta": {"kind": "images"}}

What is kept in full, always: the first user message (the per-beat block); the last write_scene / write_cue arguments (the
current sources); the last check report of each kind (`_meta.report_kind` = scene | cue | finish); the last KEEP_TAIL messages.
What is elided when over budget, oldest first: older tool results (to their one-line `_meta.summary`), older full-source
write_* arguments (to the same summary), then long older assistant prose. Only the most recent preview keeps its images.
Compaction never changes the message structure (ids and order), so the conversation stays valid for the API.
"""
from __future__ import annotations

import base64
import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .state import strip_internal

KEEP_TAIL = 6
IMAGE_TOKENS = 1000
ASSISTANT_TEXT_LIMIT = 240
WRITE_TOOLS = ("write_scene", "write_cue")
OMITTED_IMAGE_TEXT = "[preview image omitted: only the most recent preview is kept]"


def _text_chars(m: dict[str, Any]) -> tuple[int, int]:
    """(characters, images) of one message as the API would see it."""
    imgs = 0
    d = strip_internal(m)
    c = d.get("content")
    if isinstance(c, list):
        parts = []
        for p in c:
            if isinstance(p, dict) and p.get("type") in ("image_file", "image_url"):
                imgs += 1
            else:
                parts.append(p)
        d["content"] = parts
    return len(json.dumps(d, ensure_ascii=False)), imgs


def estimate_tokens(messages: list[dict[str, Any]], system: str = "") -> int:
    """Approximate token count: characters / 4, plus a flat IMAGE_TOKENS per image."""
    chars, imgs = len(system), 0
    for m in messages:
        c, i = _text_chars(m)
        chars, imgs = chars + c, imgs + i
    return chars // 4 + imgs * IMAGE_TOKENS


@dataclass
class Prepared:
    messages: list[dict[str, Any]]        # ready to send (no `_meta`; latest preview images as data URLs)
    tokens_before: int
    tokens_after: int
    elided: int                           # number of elisions applied
    over_budget: bool                     # still above the budget after every elision
    hopeless: bool                        # above 1.5x the budget: the loop should stop (cap:context)


def _generic_summary(name: str, ok: bool, size: int) -> str:
    return f"[{name}: {'ok' if ok else 'error'}, {size} bytes elided]"


def _last_index(messages: list[dict[str, Any]], pred) -> int | None:
    for i in range(len(messages) - 1, -1, -1):
        if pred(messages[i]):
            return i
    return None


def _protected(messages: list[dict[str, Any]]) -> tuple[set[int], set[str]]:
    """Indices of messages that stay in full, and tool_call ids whose arguments stay in full."""
    keep: set[int] = {0} if messages else set()
    keep.update(range(max(0, len(messages) - KEEP_TAIL), len(messages)))
    for kind in ("scene", "cue", "finish"):
        i = _last_index(messages, lambda m, k=kind: m.get("role") == "tool" and (m.get("_meta") or {}).get("report_kind") == k)
        if i is not None:
            keep.add(i)
    keep_args: set[str] = set()
    for tool in WRITE_TOOLS:
        i = _last_index(messages, lambda m, t=tool: m.get("role") == "tool" and (m.get("_meta") or {}).get("name") == t)
        if i is not None and messages[i].get("tool_call_id"):
            keep_args.add(messages[i]["tool_call_id"])
    # a write call whose tool message has not arrived yet (the turn in progress) is protected by KEEP_TAIL
    return keep, keep_args


def _image_data_url(root: Path | None, rel: str) -> str | None:
    if root is None:
        return None
    try:
        p = (Path(root) / rel).resolve()
        if Path(root).resolve() not in p.parents:
            return None
        data = base64.b64encode(p.read_bytes()).decode("ascii")
    except OSError:
        return None
    return f"data:image/jpeg;base64,{data}"


def prepare_messages(messages: list[dict[str, Any]], *, budget: int, system: str = "", media_root: Path | None = None) -> Prepared:
    """Compact (only when over `budget`) and render the conversation for the API. Never mutates `messages`."""
    msgs = copy.deepcopy(messages)
    # ---- images: only the most recent preview keeps them (always, not only over budget: they are expensive) ----
    last_img = _last_index(msgs, lambda m: isinstance(m.get("content"), list) and any(isinstance(p, dict) and p.get("type") == "image_file" for p in m["content"]))
    for i, m in enumerate(msgs):
        if isinstance(m.get("content"), list) and i != last_img:
            m["content"] = [({"type": "text", "text": OMITTED_IMAGE_TEXT} if isinstance(p, dict) and p.get("type") in ("image_file", "image_url") else p)
                            for p in m["content"]]
    before = estimate_tokens(msgs, system)
    elided = 0
    if before > budget:
        keep, keep_args = _protected(msgs)
        # call id -> summary, from the tool messages (also used to elide the matching assistant arguments)
        summaries = {m.get("tool_call_id"): (m.get("_meta") or {}).get("summary") for m in msgs if m.get("role") == "tool"}
        # pass 1: older tool results -> one line
        for i, m in enumerate(msgs):
            if estimate_tokens(msgs, system) <= budget:
                break
            if m.get("role") == "tool" and i not in keep and not str(m.get("content", "")).startswith("[") :
                meta = m.get("_meta") or {}
                size = len(str(m.get("content", "")))
                m["content"] = meta.get("summary") or _generic_summary(meta.get("name", "tool"), bool(meta.get("ok", True)), size)
                elided += 1
        # pass 2: older full-source write_* arguments -> one line
        for i, m in enumerate(msgs):
            if estimate_tokens(msgs, system) <= budget:
                break
            if m.get("role") != "assistant" or i in keep:
                continue
            for c in m.get("tool_calls") or []:
                fn = c.get("function") or {}
                if fn.get("name") in WRITE_TOOLS and c.get("id") not in keep_args and not fn.get("arguments", "").startswith('{"elided"'):
                    note = summaries.get(c.get("id")) or f"[{fn.get('name')}: source elided]"
                    fn["arguments"] = json.dumps({"elided": note}, ensure_ascii=False)
                    elided += 1
        # pass 3: older assistant prose
        for i, m in enumerate(msgs):
            if estimate_tokens(msgs, system) <= budget:
                break
            if m.get("role") == "assistant" and i not in keep and isinstance(m.get("content"), str) and len(m["content"]) > ASSISTANT_TEXT_LIMIT:
                m["content"] = m["content"][:ASSISTANT_TEXT_LIMIT] + " [...]"
                elided += 1
    after = estimate_tokens(msgs, system)
    # ---- render: data URLs for the kept images, drop `_meta` ----
    out = []
    for m in msgs:
        d = strip_internal(m)
        if isinstance(d.get("content"), list):
            parts = []
            for p in d["content"]:
                if isinstance(p, dict) and p.get("type") == "image_file":
                    url = _image_data_url(media_root, p.get("path", ""))
                    parts.append({"type": "image_url", "image_url": {"url": url}} if url else {"type": "text", "text": "[preview image unavailable]"})
                else:
                    parts.append(p)
            d["content"] = parts
        out.append(d)
    return Prepared(out, before, after, elided, over_budget=after > budget, hopeless=after > budget * 1.5)
