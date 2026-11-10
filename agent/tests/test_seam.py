"""Seams with the rest of the repo: the runner reads tool envelopes exactly as vbeat_shared does, imports only what it may, and the words
that are banned elsewhere stay inside agent/."""
import ast
import re

import pytest
from conftest import AGENT, REPO

from vbeat_shared.envelope import CONTENT_ERROR_TYPES, Outcome, classify, make_envelope
from vbeat_agent.toolrun import ToolResult


def test_runner_verdicts_are_the_shared_classification():
    content_type = sorted(CONTENT_ERROR_TYPES)[0]
    table = [
        (make_envelope("x", ok=True, report={"ok": True}), Outcome.PASS),
        (make_envelope("x", ok=True, report={"ok": False}), Outcome.REPORT_FAILED),
        (make_envelope("x", ok=False, error={"type": content_type, "message": "bad input"}), Outcome.CONTENT_FAULT),
        (make_envelope("x", ok=False, error={"type": "crash", "message": "boom"}), Outcome.TOOL_FAILED),
        (make_envelope("x", ok=False), Outcome.TOOL_FAILED),
    ]
    for env, want in table:
        assert classify(env) is want
        assert ToolResult(env=env, outcome=classify(env), returncode=0, stderr_tail="", wall_ms=0).outcome is want


def _imported_roots(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    roots = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            roots |= {a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
            roots.add(n.module.split(".")[0])
    return roots


def test_the_agent_imports_only_shared_and_the_standard_library():
    allowed_third_party = {"PIL", "vbeat_shared", "vbeat_agent"}          # PIL: lazy and optional (preview downscaling)
    stdlib = set(__import__("sys").stdlib_module_names)
    for p in (AGENT / "src" / "vbeat_agent").glob("*.py"):
        extra = {r for r in _imported_roots(p) if r not in stdlib and r not in allowed_third_party}
        assert not extra, f"{p.name} imports {extra}"
    for forbidden in ("vbeat_sprite", "vbeat_audio", "vbeat_pipeline", "backend", "devserver", "playwright"):
        for p in (AGENT / "src" / "vbeat_agent").glob("*.py"):
            assert forbidden not in _imported_roots(p), (p.name, forbidden)


def test_pil_is_only_ever_imported_lazily():
    for p in (AGENT / "src" / "vbeat_agent").glob("*.py"):
        for node in ast.parse(p.read_text()).body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] + [getattr(node, "module", "") or ""]
                assert not any(n.split(".")[0] == "PIL" for n in names), f"{p.name} imports PIL at module level"


def test_no_model_names_or_provider_strings_outside_agent():
    pat = re.compile(r"(?i)openrouter|claude-(?:sonnet|opus|haiku|fable)|anthropic/|openai/|gpt-[0-9]")
    offenders = []
    for top in ("shared/src", "engine/src", "audio/src", "pipeline/src", "devserver", "frontend", "scripts"):
        root = REPO / top
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix in (".py", ".js", ".html", ".css", ".json", ".sh", ".ts", ".tsx") and "node_modules" not in p.parts:
                try:
                    if pat.search(p.read_text(encoding="utf-8")):
                        offenders.append(str(p.relative_to(REPO)))
                except (UnicodeDecodeError, OSError):
                    pass
    assert not offenders, offenders


def test_the_agent_touches_the_frozen_packages_only_through_subprocesses():
    src = "\n".join(p.read_text() for p in (AGENT / "src" / "vbeat_agent").glob("*.py"))
    assert "subprocess" in src and "create_subprocess_exec" in src
    for module in ("vbeat_sprite", "vbeat_audio", "vbeat_pipeline"):
        assert not re.search(rf"^\s*(import|from)\s+{module}\b", src, re.M), module


def test_public_interface_is_importable_from_the_package_root():
    import vbeat_agent
    for name in ("BeatRequest", "BeatResult", "run_beat", "continue_beat", "revert_beat", "run_beats", "EventSink", "FileEventSink", "CallbackSink",
                 "events_to_messages", "preflight", "selftest", "diagnose"):
        assert hasattr(vbeat_agent, name), name
    assert vbeat_agent.__all__ and all(hasattr(vbeat_agent, n) for n in vbeat_agent.__all__)
