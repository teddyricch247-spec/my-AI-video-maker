"""The system prompt and the per-beat message, built at runtime from the repo's own documents so they cannot drift from the tools.

Order (stable prefix first, so provider prompt caching can work; per-beat content goes in the first user message):
role -> hard rules -> runtime API (CONTRACTS s5 + engine INTERFACES) -> style guide (verbatim) -> asset catalogue (generated)
-> SFX style + synth API (verbatim) -> worked example -> workflow.
A document whose expected heading has gone missing raises PromptBuildError: a silent gap would degrade every beat.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from vbeat_shared.markers import MARKER_KINDS

from .config import Settings, repo_root


class PromptBuildError(RuntimeError):
    pass


def md_section(text: str, heading: str, *, source: str = "") -> str:
    """The section whose heading line starts with `heading` (e.g. '## 5.'), up to the next heading of the same or higher level."""
    lines = text.splitlines()
    level = len(heading) - len(heading.lstrip("#"))
    start = next((i for i, ln in enumerate(lines) if ln.startswith(heading)), None)
    if start is None:
        raise PromptBuildError(f"heading {heading!r} not found in {source or 'document'}; the prompt is built from it")
    end = len(lines)
    for j in range(start + 1, len(lines)):
        m = re.match(r"^(#+)\s", lines[j])
        if m and len(m.group(1)) <= level:
            end = j
            break
    body = "\n".join(lines[start:end]).strip()
    if len(body.splitlines()) < 2:
        raise PromptBuildError(f"section {heading!r} in {source or 'document'} is empty")
    return body


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except OSError as exc:
        raise PromptBuildError(f"cannot read {p}: {exc}") from None


ROLE = """You are the beat author for ONE beat of a narrated explainer video. You write two files, `scene.js` (a Canvas 2D scene that is a pure function of time) and `cue.py` (a small sound-design script), by calling tools. Deterministic tools check your work and their reports are the truth. The picture must support the narration, not decorate it. When both files pass, call `finish`; a human reviews the result."""

RULES = """HARD RULES
- Use only the tools. You have no shell and no other files. Every file you write is a complete file, never a patch.
- One idea per beat. Show what the narration says, when it says it.
- Time every important visual event from a WORD ANCHOR: rt.at(wordId, edge, offset). Never from guessed seconds. Word ids come from get_beat_info.
- Reuse the asset library (rt.lib.draw('tech/big-stat', t, {...})) instead of drawing from scratch. Look assets up with search_assets / get_asset; never invent an asset id or a param.
- The canvas is 1280x720. Text stays inside it with the safe margin from the style guide and is at least 14 px.
- No randomness (use rt.rng(seed)), no clocks, no network, no storage, no globals that change between frames. The scene is a pure function of t: drawing t twice gives the same pixels.
- Stay within the beat's duration, but settle into a readable final state and hold it.
- Sound effects: silence is fine. At most one sound per ~1.5 s. Never music or voices. Anchor to scene markers (ctx.marker) or word ids (ctx.at).
- Do not use ask_user unless the beat cannot be done at all without the answer. When the direction or the narration is ambiguous, make a good decision and note it in finish.summary."""

WORKFLOW = """WORKFLOW
1. get_beat_info (words, ids, times, duration).  2. search_assets / get_asset: pick assets that carry the idea.  3. write_scene.
4. Fix findings. Fix the EARLIEST error first, one change at a time; do not rewrite the whole scene to fix one finding.
5. preview and LOOK at it (if you can see images): does it say what the narration says, at the moment it says it?
6. check_scene level=full: the automatic check after write_scene is `fast` and does NOT check text bounds (C4), overlap (C5), frozen frames (C7) or determinism (C8). Run the full check after any change to layout or text.
7. get_markers, then write_cue. Fix A-codes the same way.  8. finish. If finish fails, it names the stage and findings: fix those, then call finish again.
The check output is the truth; your belief that the scene is fine is not. If you are repeating yourself, change approach or call give_up with a clear reason."""


def _catalogue(assets: list[dict[str, Any]]) -> str:
    rows = []
    for a in assets:
        desc = a.get("description", "").split(". ")[0].rstrip(".")[:120]
        anchors = ",".join((a.get("anchors") or {}).keys()) or "-"
        markers = ",".join(a.get("markers") or []) or "-"
        rows.append(f"{a['id']} | {a.get('kind', '')} | {desc} | anchors: {anchors} | markers: {markers}")
    return "\n".join(rows)


def _load_assets(settings: Settings, mode: str) -> list[dict[str, Any]]:
    import json
    raw = json.loads(_read(settings.assets_dir / "index.json"))
    if isinstance(raw.get("assets"), list):
        assets = raw["assets"]
    else:
        assets = [a for m in raw.get("modules", []) if isinstance(m, dict) for a in m.get("assets", [])]
    allowed = {"technical": {"technical", "both"}, "story": {"story", "both"}}.get(mode)
    return [a for a in assets if allowed is None or a.get("mode", "both") in allowed]


def _synth_api(root: Path) -> str:
    p = root / "audio" / "sfx" / "SYNTH_API.md"
    if p.exists():
        return _read(p)
    out = subprocess.run([sys.executable, "-m", "vbeat_audio", "docs"], capture_output=True, text=True)   # generated from the code
    if out.returncode != 0 or not out.stdout.strip():
        raise PromptBuildError("SYNTH_API.md is missing and `vbeat_audio docs` produced nothing")
    return out.stdout


def build_system_prompt(settings: Settings, mode: str = "technical", sfx_enabled: bool = True) -> tuple[str, list[tuple[str, int]]]:
    """Returns (prompt, [(section name, chars)]). Deterministic for a given repo checkout."""
    root = repo_root()
    contracts = _read(root / "docs" / "CONTRACTS.md")
    iface = _read(root / "engine" / "docs" / "INTERFACES.md")
    style = _read(settings.assets_dir / "style-guide.md").strip()
    sfx_style = _read(root / "audio" / "sfx" / "sfx-style.md").strip()
    example_scene = _read(root / "examples" / "beats" / "big_number" / "scene.js").strip()
    example_cue = _read(root / "examples" / "beats" / "big_number" / "cue.py").strip()
    assets = _load_assets(settings, mode)
    if not assets:
        raise PromptBuildError(f"the asset index lists no assets usable for mode {mode!r}")
    kinds = "marker kinds: " + ", ".join(MARKER_KINDS)
    runtime = "\n\n".join([
        md_section(contracts, "## 5.", source="docs/CONTRACTS.md"),
        md_section(iface, "## Scene module", source="engine/docs/INTERFACES.md"),
        md_section(iface, "## rt API", source="engine/docs/INTERFACES.md"),
        md_section(iface, "## Checks", source="engine/docs/INTERFACES.md"),
    ])
    sections: list[tuple[str, str]] = [
        ("role", ROLE), ("rules", RULES),
        ("runtime", "SCENE RUNTIME AND CHECKS (what you write against)\n\n" + runtime),
        ("style", "STYLE GUIDE (verbatim)\n\n" + style),
        ("catalogue", f"ASSET CATALOGUE ({len(assets)} assets; id | kind | description | anchors | markers). Full metadata only via get_asset.\n\n" + _catalogue(assets)),
    ]
    if sfx_enabled:
        sections += [("sfx_style", "SFX STYLE (verbatim)\n\n" + sfx_style + f"\n\n({kinds})"),
                     ("synth_api", "SYNTH API (verbatim)\n\n" + _synth_api(root).strip())]
    else:
        sections.append(("sfx_off", "Sound effects are DISABLED for this beat: there is no write_cue tool. Write only the scene, then finish."))
    sections += [
        ("example", "WORKED EXAMPLE: a pattern to learn from, not a template to copy. The beat is different; the ideas (word anchors, assets, markers, settling) carry over.\n\n"
                    f"scene.js:\n{example_scene}\n\ncue.py:\n{example_cue}"),
        ("workflow", WORKFLOW),
    ]
    text = "\n\n---\n\n".join(body for _, body in sections)
    return text, [(name, len(body)) for name, body in sections]


# ---- the per-beat message ----------------------------------------------------------------------------------------------

def format_beat_info(req: Any, spec: dict[str, Any]) -> str:
    fps = spec["project"]["fps"]
    b = spec["beat"]
    dur = (b["f1"] - b["f0"]) / fps
    out = [f'Beat {req.idx}: "{req.title or "(untitled)"}" | mode {req.mode} | {dur:.2f} s ({b["f1"] - b["f0"]} frames at {fps} fps) | canvas 1280x720']
    out.append(f"Direction: {req.direction or '(none given: decide what best serves the narration)'}")
    if getattr(req, "bible", None):
        out.append(f"Project notes (style and continuity):\n{req.bible}")
    nb = getattr(req, "neighbours", None) or {}
    for side in ("prev", "next"):
        if nb.get(side):
            out.append(f"{'Previous' if side == 'prev' else 'Next'} beat: {nb[side].get('title', '')}: {nb[side].get('summary', '')}")
    media = list((getattr(req, "media", None) or {}).keys())
    if media:
        out.append("Media ids (use through the runtime's media API): " + ", ".join(media))
    out.append("Words (id, beat-local start-end seconds, text). Anchor with rt.at(id):")
    for w in spec["words"]:
        s, e = (w["f0"] - b["f0"]) / fps, (w["f1"] - b["f0"]) / fps
        out.append(f"{w['id']}  {s:5.2f}-{e:5.2f}  {w['text']}")
    return "\n".join(out)


def build_beat_message(req: Any, spec: dict[str, Any], caps: Any, supports_images: bool) -> str:
    imgs = "You can see images: look at your previews." if supports_images else "You cannot see images: rely on the check reports (run check_scene level=full)."
    return (format_beat_info(req, spec) + "\n\n" +
            f"Limits for this run: {caps.max_steps} steps, ${caps.max_usd:.2f}, {caps.max_minutes:g} minutes. {imgs} "
            f"Sound effects: {'enabled' if req.sfx_enabled else 'disabled'}.\nBegin.")


def build_reviewer_message(text: str, scene_n: int | None, sfx_n: int | None, answering: str | None = None) -> str:
    head = "MESSAGE FROM THE HUMAN REVIEWER" + (f" (answering your question: {answering!r})" if answering else "")
    cur = f"Current versions: scene v{scene_n if scene_n else '-'}, cue v{sfx_n if sfx_n else '-'}. The files on disk match them."
    return f"{head}\n{text.strip()}\n\n{cur} Make the change they ask for, keep what already works, and call finish again when the beat passes."
