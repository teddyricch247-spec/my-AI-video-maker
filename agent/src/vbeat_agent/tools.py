"""The beat agent's tools: what the model can do. It never gets a shell or a path: every file the tools touch is derived from
the beat directory by this module (and `BeatPaths.safe` proves it stays inside).

Result text is short and actionable: the engine's / audio's own findings verbatim plus at most a couple of lines of framing,
capped at 4 KB by the loop (and say so when truncated).
"""
from __future__ import annotations

import difflib
import hashlib
import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from vbeat_shared.envelope import Outcome

from .config import Settings
from .events import Emitter
from .loop import EndSignal, ModelFault, Tool, ToolOutcome, ToolRegistry
from .prompts import format_beat_info
from .state import BeatPaths, StateStore, VersionStore, copy_atomic, read_json, write_json_atomic
from .toolrun import ToolFault, ToolResult, Toolbox

MAX_SCENE_BYTES = 200_000
MAX_CUE_BYTES = 100_000
FAST_NOTE = ("The automatic check is `fast` (C1, C2, C3, C6). Text bounds (C4), overlap (C5), frozen frames (C7) and "
             "determinism (C8) are only checked by `check_scene` level=full.")


@dataclass
class BeatContext:
    paths: BeatPaths
    req: Any                                  # BeatRequest
    settings: Settings
    box: Toolbox
    state: StateStore
    versions: VersionStore
    emit: Emitter
    supports_images: bool = False
    _index: list[dict[str, Any]] | None = field(default=None, repr=False)

    # ---- data helpers ----
    def spec(self) -> dict[str, Any]:
        s = read_json(self.paths.spec)
        if not s:
            raise ToolFault("spec.json is missing; the beat directory was not prepared")
        return s

    def duration_s(self) -> float:
        s = self.spec()
        return (s["beat"]["f1"] - s["beat"]["f0"]) / s["project"]["fps"]

    def word_ids(self) -> list[str]:
        return [w["id"] for w in self.spec()["words"]]

    def index(self) -> list[dict[str, Any]]:
        """index.json filtered by the beat's mode, so story assets appear the day they are dropped in (no code change)."""
        if self._index is None:
            raw = read_json(self.settings.assets_dir / "index.json", {}) or {}
            mode = self.req.mode
            allowed = {"technical": {"technical", "both"}, "story": {"story", "both"}}.get(mode)
            self._index = self._load_assets(raw)
            if allowed is not None:
                self._index = [a for a in self._index if a.get("mode", "both") in allowed]
        return self._index

    @staticmethod
    def _load_assets(raw: dict[str, Any]) -> list[dict[str, Any]]:
        if isinstance(raw.get("assets"), list):
            return raw["assets"]
        out: list[dict[str, Any]] = []
        for m in raw.get("modules", []):          # index.json groups assets by module
            out.extend(m.get("assets", []) if isinstance(m, dict) else [])
        return out


# ---- small pure helpers (unit-tested) -----------------------------------------------------------------------------------

_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\n(.*?)\n?```\s*$", re.S)


def clean_source(src: str) -> str:
    """Models often wrap code in a markdown fence even when told not to; the fence is never part of the file."""
    m = _FENCE.match(src)
    return (m.group(1) if m else src).replace("\r\n", "\n")


_AT = re.compile(r"""\brt\.at\(\s*(['"])([^'"]+)\1""")
_RANGE = re.compile(r"""\brt\.range\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3""")


def literal_word_ids(source: str) -> list[str]:
    ids = [m.group(2) for m in _AT.finditer(source)]
    for m in _RANGE.finditer(source):
        ids += [m.group(2), m.group(4)]
    return ids


def unknown_word_ids(source: str, valid: list[str]) -> list[str]:
    vs = set(valid)
    seen: list[str] = []
    for i in literal_word_ids(source):
        if i not in vs and i not in seen:
            seen.append(i)
    return seen


def finding_codes(text: str) -> list[str]:
    """Codes (C4, A0, ...) of the error lines of a report text, first-seen order."""
    out: list[str] = []
    for line in text.splitlines():
        m = re.match(r"\s*([CA]\d+)\s+error\b", line)
        if m and m.group(1) not in out:
            out.append(m.group(1))
    return out


def report_counts(rep: dict[str, Any] | None) -> tuple[int, int]:
    c = (rep or {}).get("counts") or {}
    return int(c.get("error", 0)), int(c.get("warn", 0))


def kb(n: int) -> str:
    return f"{n / 1024:.1f} KB"


def downscale_jpeg(src: Path, dst: Path, max_w: int = 960) -> Path:
    """<= 960 px wide JPEG q80 for the model. Pillow is optional: without it the file is used as it is."""
    try:
        from PIL import Image
    except ImportError:
        if src != dst:
            shutil.copyfile(src, dst)
        return dst
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=80)
    return dst


def _sig(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:12]


# ---- tool construction --------------------------------------------------------------------------------------------------

def _obj(props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or [], "additionalProperties": False}


def build_beat_tools(ctx: BeatContext) -> ToolRegistry:
    reg = ToolRegistry()
    paths, vs, box, state = ctx.paths, ctx.versions, ctx.box, ctx.state
    namespaces = sorted({a["id"].split("/")[0] for a in ctx.index()})

    # ---------------------------------------------------------------- discovery
    async def search_assets(a: dict[str, Any]) -> ToolOutcome:
        q = (a.get("query") or "").lower().split()
        kind, tag, limit = a.get("kind"), (a.get("tag") or "").lower(), int(a.get("limit", 12))
        scored = []
        for asset in ctx.index():
            ns = asset["id"].split("/")[0]
            if kind and kind not in (ns, asset.get("kind")):
                continue
            tags = [t.lower() for t in asset.get("tags", [])]
            if tag and tag not in tags:
                continue
            hay_id, hay_title = asset["id"].lower(), asset.get("title", "").lower()
            hay_desc = asset.get("description", "").lower()
            score = 0
            for tok in q:
                score += 4 * (tok in hay_id) + 3 * (tok in hay_title) + 3 * (tok in tags) + (tok in hay_desc)
            if q and score == 0:
                continue
            scored.append((-score, asset["id"], asset))
        scored.sort(key=lambda x: (x[0], x[1]))
        rows = scored[:limit]
        if not rows:
            return ToolOutcome(True, "No assets matched. Try fewer or different words, or list a whole family with kind=" +
                               "/".join(namespaces) + ".", summary="[search_assets: 0 results]")
        lines = []
        for _, _, asset in rows:
            desc = asset.get("description", "").split(". ")[0][:140]
            lines.append(f"{asset['id']} | {asset.get('title', '')} | {desc} | markers: {','.join(asset.get('markers', [])) or '-'} | tags: {','.join(asset.get('tags', []))}")
        more = f"\n({len(scored) - limit} more; narrow the query)" if len(scored) > limit else ""
        return ToolOutcome(True, "\n".join(lines) + more, summary=f"[search_assets {a.get('query') or a.get('tag') or kind or ''!r}: {len(rows)} results]")

    async def get_asset(a: dict[str, Any]) -> ToolOutcome:
        aid = a["id"]
        found = next((x for x in ctx.index() if x["id"] == aid), None)
        if found is None:
            ids = [x["id"] for x in ctx.index()]
            close = difflib.get_close_matches(aid, ids, n=5, cutoff=0.0)
            sub = [i for i in ids if aid.split("/")[-1] in i and i not in close]
            near = (close + sub)[:5]
            return ToolOutcome.fault(f"Unknown asset '{aid}'. Closest ids: {', '.join(near)}", summary=f"[get_asset {aid}: unknown]")
        keep = ("id", "title", "kind", "description", "duration", "holds", "params", "anchors", "markers", "tags", "bounds", "origin", "example")
        body = {k: found[k] for k in keep if k in found}
        return ToolOutcome(True, json.dumps(body, ensure_ascii=False, indent=1), summary=f"[get_asset {aid}]")

    async def get_beat_info(a: dict[str, Any]) -> ToolOutcome:
        return ToolOutcome(True, format_beat_info(ctx.req, ctx.spec()), summary="[get_beat_info]")

    # ---------------------------------------------------------------- scene
    def scene_outcome(n: int, res: ToolResult, level: str, head: str) -> ToolOutcome:
        rep = res.report or {}
        errs, warns = report_counts(rep)
        text = rep.get("text", "")
        codes = finding_codes(text)
        body = f"{head} {level} check: {errs} errors, {warns} warnings.\n{text}"
        if level == "fast" and errs == 0:
            body += f"\n{FAST_NOTE}"
        summ = f"[{head.split(' (')[0].split(' v')[0]} v{n}: {errs} errors" + (f" {','.join(codes)}" if codes else "") + f", {warns} warnings]"
        return ToolOutcome(errs == 0, body, kind=None if errs == 0 else "model_fault", summary=summ, report_kind="scene",
                           signature=None if errs == 0 else _sig(re.sub(r"\d+(\.\d+)?ms", "", text)),
                           data={"scene_n": n, "errors": errs, "warnings": warns})

    async def run_check(n: int, level: str) -> ToolResult:
        res = await box.check(level)
        if res.outcome is Outcome.TOOL_FAILED:
            raise ToolFault(f"engine check failed: {res.error_text}", detail=res.stderr_tail)
        return res

    def record_check(n: int, res: ToolResult, level: str) -> dict[str, Any]:
        if res.outcome is Outcome.CONTENT_FAULT:      # e.g. the scene is too large or cannot be loaded at all
            rep = {"ok": False, "level": level, "counts": {"error": 1, "warn": 0}, "findings": [], "text": res.error_text}
        else:
            rep = dict(res.report or {})
        rep["level"] = level
        vs.save_scene_check(n, rep)
        if level == "full":
            state.update(full_ok_n=n if rep.get("ok") else None)
        state.update(last_report={"kind": "scene", "n": n, "level": level, "ok": bool(rep.get("ok")), "counts": rep.get("counts"),
                                  "text": rep.get("text", "")[:2000]})
        return rep

    async def write_scene(a: dict[str, Any]) -> ToolOutcome:
        src = clean_source(a["source"])
        size = len(src.encode("utf-8"))
        if size > MAX_SCENE_BYTES:
            raise ModelFault(f"scene is {kb(size)}; the limit is 200 KB. Use the asset library (rt.lib.draw) instead of drawing from scratch.")
        if len(re.sub(r"//[^\n]*|/\*.*?\*/|\s+", "", src, flags=re.S)) < 30:
            raise ModelFault("scene is empty or trivial. Write a scene module that exports draw(rt, t); see the worked example in the system prompt.")
        bad = unknown_word_ids(src, ctx.word_ids())
        if bad:
            ids = ctx.word_ids()
            hint = "; ".join(f"{b}: did you mean {', '.join(difflib.get_close_matches(b, ids, n=3, cutoff=0.0))}?" for b in bad[:4])
            raise ModelFault(f"rt.at/rt.range use word ids that are not in this beat: {', '.join(bad)}. Valid ids are {ids[0]}..{ids[-1]} "
                             f"({len(ids)} words; call get_beat_info). {hint}")
        n, reused = vs.save("scene", src, note=a.get("note", ""), step=ctx.emit.step)
        state.update(full_ok_n=None)
        level = ctx.settings.write_check_level
        res = await run_check(n, level)
        rep = record_check(n, res, level)
        out = scene_outcome(n, res, level, f"Saved scene v{n} ({kb(size)}).") if res.outcome is not Outcome.CONTENT_FAULT else \
            ToolOutcome(False, f"Saved scene v{n} but it cannot be checked: {res.error_text}", kind="model_fault",
                        summary=f"[write_scene v{n}: {res.error_text[:80]}]", report_kind="scene", data={"scene_n": n})
        ctx.emit("scene_version", n=n, checks={"error": report_counts(rep)[0], "warn": report_counts(rep)[1]}, level=level, note=a.get("note", ""),
                 bytes=size, path=paths.rel(paths.scene_version(n)))
        if ctx.settings.strip_each_version and rep.get("ok"):
            r = await box.strip(paths.preview / "_tmp")
            if r.outcome is Outcome.PASS and Path(r.artifacts.get("strip", "")).exists():
                copy_atomic(Path(r.artifacts["strip"]), paths.scene_strip(n))
        return out

    async def check_scene(a: dict[str, Any]) -> ToolOutcome:
        n = vs.current_n("scene")
        if not n:
            raise ModelFault("there is no scene yet; call write_scene first.")
        level = a["level"]
        res = await run_check(n, level)
        rep = record_check(n, res, level)
        if res.outcome is Outcome.CONTENT_FAULT:
            return ToolOutcome(False, f"Scene v{n} cannot be checked: {res.error_text}", kind="model_fault", summary=f"[check_scene v{n}: {res.error_text[:80]}]",
                               report_kind="scene")
        ctx.emit("scene_version", n=n, checks={"error": report_counts(rep)[0], "warn": report_counts(rep)[1]}, level=level, rechecked=True,
                 path=paths.rel(paths.scene_version(n)))
        return scene_outcome(n, res, level, f"Scene v{n}")

    async def preview(a: dict[str, Any]) -> ToolOutcome:
        n = vs.current_n("scene")
        if not n:
            raise ModelFault("there is no scene yet; call write_scene first.")
        times = a.get("times")
        dur = ctx.duration_s()
        paths.preview.mkdir(parents=True, exist_ok=True)
        files: list[Path] = []
        if times:
            bad = [t for t in times if t < 0 or t > dur]
            if bad:
                raise ModelFault(f"times {bad} are outside this beat (0..{dur:.2f} s, beat-local seconds).")
            tmp = paths.preview / f"_tmp_{n:03d}"
            shutil.rmtree(tmp, ignore_errors=True)
            res = await box.frames(sorted(times), tmp, "960x540")
            if res.outcome is Outcome.TOOL_FAILED:
                raise ToolFault(f"frames failed: {res.error_text}", detail=res.stderr_tail)
            if res.outcome is Outcome.CONTENT_FAULT:
                return ToolOutcome(False, f"Cannot render the scene: {res.error_text}", kind="model_fault", summary=f"[preview: {res.error_text[:80]}]")
            for f in sorted(tmp.glob("*.jpg")):
                dst = paths.preview / f"scene_{n:03d}_{f.name.replace('frame_', '')}"
                shutil.move(str(f), dst)
                files.append(dst)
            shutil.rmtree(tmp, ignore_errors=True)
            what = f"{len(files)} frames at t={', '.join(f'{t:g}' for t in sorted(times))} s"
        else:
            tmp = paths.preview / f"_tmp_{n:03d}"
            shutil.rmtree(tmp, ignore_errors=True)
            res = await box.strip(tmp)
            if res.outcome is Outcome.TOOL_FAILED:
                raise ToolFault(f"strip failed: {res.error_text}", detail=res.stderr_tail)
            if res.outcome is Outcome.CONTENT_FAULT:
                return ToolOutcome(False, f"Cannot render the scene: {res.error_text}", kind="model_fault", summary=f"[preview: {res.error_text[:80]}]")
            full = paths.scene_strip(n)
            copy_atomic(tmp / "strip.jpg", full)
            shutil.rmtree(tmp, ignore_errors=True)
            files = [full]
            what = "the contact strip (evenly spaced frames, left to right, top to bottom)"
        rels = [paths.rel(f) for f in files]
        if ctx.supports_images:
            model_files = []
            for f in files:
                m = paths.preview / f"{f.stem}.model.jpg"
                model_files.append(downscale_jpeg(f, m))
            return ToolOutcome(True, f"Rendered {what} of scene v{n}. The images follow in the next message.\nFiles: {', '.join(rels)}",
                               images=[Path(paths.rel(m)) for m in model_files], image_paths=rels, summary=f"[preview v{n}: {len(files)} images]")
        return ToolOutcome(True, f"Rendered {what} of scene v{n} (saved: {', '.join(rels)}). This model cannot view images, so rely on the "
                                 "check reports; `check_scene` level=full verifies layout.", image_paths=rels, summary=f"[preview v{n}: {len(files)} images, not shown]")

    async def get_markers(a: dict[str, Any]) -> ToolOutcome:
        if not vs.current_n("scene"):
            raise ModelFault("there is no scene yet; call write_scene first.")
        markers, warn = await ensure_markers(force=True)
        if warn:
            return ToolOutcome.fault(warn, summary="[get_markers: failed]")
        if not markers:
            return ToolOutcome(True, "The scene exports no markers (no markers(rt) function, or it returns none). Anchor sounds to word ids with ctx.at(...) instead.",
                               summary="[get_markers: 0]")
        lines = [f"{m['id']}\tt={m['t']:.3f}s\t{m['kind']}" for m in markers]
        return ToolOutcome(True, f"{len(markers)} markers for scene v{vs.current_n('scene')} (id, time, kind):\n" + "\n".join(lines),
                           summary=f"[get_markers: {len(markers)}]")

    async def ensure_markers(force: bool = False) -> tuple[list[dict[str, Any]], str | None]:
        """Fresh markers for the current scene version. Returns (markers, problem); on a scene fault the stale file is removed."""
        n = vs.current_n("scene")
        st = state.load()
        if not force and st["markers_n"] == n and paths.markers.exists():
            return read_json(paths.markers, []) or [], None
        res = await box.markers()
        if res.outcome is Outcome.TOOL_FAILED:
            raise ToolFault(f"markers failed: {res.error_text}", detail=res.stderr_tail)
        if res.outcome is Outcome.CONTENT_FAULT:
            paths.markers.unlink(missing_ok=True)
            state.update(markers_n=None)
            return [], f"The scene's markers could not be computed: {res.error_text}"
        state.update(markers_n=n)
        return read_json(paths.markers, []) or [], None

    async def revert_scene(a: dict[str, Any]) -> ToolOutcome:
        n = a["n"]
        try:
            vs.set_current("scene", n)
        except KeyError as exc:
            raise ModelFault(str(exc.args[0])) from None
        state.update(full_ok_n=None, markers_n=None)
        rep = vs.scene_report(n)
        e, w = report_counts(rep)
        return ToolOutcome(True, f"scene.js is now version {n} (last check: {e} errors, {w} warnings"
                                 f"{', level ' + rep['level'] if rep and rep.get('level') else ''}). Re-run check_scene if you changed assumptions.",
                           summary=f"[revert_scene -> v{n}]", data={"scene_n": n})

    # ---------------------------------------------------------------- cue
    async def write_cue(a: dict[str, Any]) -> ToolOutcome:
        if not vs.current_n("scene"):
            raise ModelFault("write the scene first: the cue is anchored to its markers.")
        src = clean_source(a["source"])
        size = len(src.encode("utf-8"))
        if size > MAX_CUE_BYTES:
            raise ModelFault(f"cue is {kb(size)}; the limit is 100 KB.")
        if len(re.sub(r"#[^\n]*|\s+", "", src)) < 20:
            raise ModelFault("cue is empty or trivial. Write a cue script with a render(ctx) function; see the worked example.")
        n, _ = vs.save("cue", src, note=a.get("note", ""), step=ctx.emit.step)
        markers, warn = await ensure_markers()
        sp = await box.sfx_spec()
        if sp.outcome is not Outcome.PASS:
            raise ToolFault(f"audio spec failed: {sp.error_text or sp.report}", detail=sp.stderr_tail)
        res = await box.sfx_render()
        if res.outcome is Outcome.TOOL_FAILED:
            raise ToolFault(f"audio render failed: {res.error_text}", detail=res.stderr_tail)
        if res.outcome is Outcome.CONTENT_FAULT:
            rep = {"ok": False, "counts": {"error": 1, "warn": 0}, "text": res.error_text, "level": "full"}
            vs.save_cue_report(n, rep, None)
            ctx.emit("sfx_version", n=n, checks={"error": 1, "warn": 0}, path=paths.rel(paths.cue_version(n)))
            return ToolOutcome(False, f"Saved cue v{n} but it failed to run: {res.error_text}", kind="model_fault", summary=f"[write_cue v{n}: {res.error_text[:80]}]",
                               report_kind="cue", data={"sfx_n": n})
        rep = dict(res.report or {})
        rep["level"] = "full"
        metrics = read_json(paths.sfx / "metrics.json")
        vs.save_cue_report(n, rep, metrics)
        wav, prev = paths.sfx / "sfx.wav", paths.sfx / "sfx_preview.jpg"
        if rep.get("ok") and wav.exists():
            copy_atomic(wav, paths.cue_wav(n))
            if prev.exists():
                copy_atomic(prev, paths.cue_preview(n))
        errs, warns = report_counts(rep)
        codes = finding_codes(rep.get("text", ""))
        state.update(last_report={"kind": "cue", "n": n, "ok": errs == 0, "counts": rep.get("counts"), "text": rep.get("text", "")[:2000]})
        ctx.emit("sfx_version", n=n, checks={"error": errs, "warn": warns}, path=paths.rel(paths.cue_version(n)))
        head = f"Saved cue v{n} ({kb(size)}). Audio check: {errs} errors, {warns} warnings."
        if metrics:
            head += f" {metrics.get('duration_s', 0):.2f} s, peak {metrics.get('peak_dbfs')} dBFS, {metrics.get('cues')} cues."
        if warn:
            head += f"\nWarning: {warn} Anchors can still use word ids via ctx.at."
        elif not markers:
            head += "\nNote: the scene has no markers; anchoring to word ids."
        return ToolOutcome(errs == 0, f"{head}\n{rep.get('text', '')}", kind=None if errs == 0 else "model_fault",
                           summary=f"[write_cue v{n}: {errs} errors" + (f" {','.join(codes)}" if codes else "") + f", {warns} warnings]",
                           report_kind="cue", signature=None if errs == 0 else _sig(rep.get("text", "")), data={"sfx_n": n, "errors": errs, "warnings": warns})

    async def revert_cue(a: dict[str, Any]) -> ToolOutcome:
        n = a["n"]
        try:
            vs.set_current("cue", n)
        except KeyError as exc:
            raise ModelFault(str(exc.args[0])) from None
        rep = vs.cue_report(n)
        e, w = report_counts(rep)
        return ToolOutcome(True, f"cue.py is now version {n} (last audio check: {e} errors, {w} warnings).", summary=f"[revert_cue -> v{n}]", data={"sfx_n": n})

    # ---------------------------------------------------------------- ending
    async def finish(a: dict[str, Any]) -> ToolOutcome:
        sn, cn = vs.current_n("scene"), vs.current_n("cue")
        if not sn:
            raise ModelFault("there is no scene yet; call write_scene first.")
        if ctx.req.sfx_enabled and not cn:
            raise ModelFault("sound effects are enabled for this beat but there is no cue yet; call write_cue (even a very sparse cue) first.")
        res = await box.pipeline(paths.scene_version(sn), paths.cue_version(cn) if (cn and ctx.req.sfx_enabled) else None, ctx.duration_s())
        pj = read_json(paths.pipeline, {}) or {}
        if res.outcome is Outcome.TOOL_FAILED:
            raise ToolFault(f"pipeline failed at stage '{pj.get('failed_stage')}': {pj.get('failure') or res.error_text}", detail=res.stderr_tail)
        env_report = res.report or {}
        if not env_report.get("ok", False) or res.outcome is not Outcome.PASS:
            stage = pj.get("failed_stage") or env_report.get("failed_stage") or "?"
            st = (pj.get("stages") or {}).get(stage) or {}
            text = (st.get("report") or {}).get("text") or pj.get("failure") or env_report.get("failure") or "no details"
            if stage == "check" and isinstance(st.get("report"), dict):
                record_check(sn, ToolResult({"report": st["report"]}, Outcome.REPORT_FAILED, 1, "", 0), "full")
            codes = finding_codes(text)
            return ToolOutcome(False, f"finish failed at stage '{stage}'. Fix it and call finish again.\n{text}", kind="model_fault",
                               summary=f"[finish: failed at {stage}" + (f" {','.join(codes)}" if codes else "") + "]", report_kind="finish",
                               signature=_sig(f"{stage}:{text}"), data={"failed_stage": stage})
        final = Path(res.artifacts.get("final") or paths.final)
        if paths.strip.exists():
            copy_atomic(paths.strip, paths.scene_strip(sn))
        state.update(final_video=str(final), final_stale=False, full_ok_n=sn, markers_n=sn if paths.markers.exists() else None)
        summary = a["summary"].strip()
        return ToolOutcome(True, "The full pipeline passed and the final video was verified. The run ends here; a human reviews it.",
                           summary=f"[finish: verified {final.name}]", report_kind="finish",
                           end=EndSignal("waiting_user", "finished", summary=summary), data={"final": paths.rel(final)})

    async def ask_user(a: dict[str, Any]) -> ToolOutcome:
        q = a["question"].strip()
        return ToolOutcome(True, "Question sent to the reviewer. The run pauses until they answer.", summary=f"[ask_user: {q[:80]}]",
                           end=EndSignal("waiting_user", "ask_user", question=q))

    async def give_up(a: dict[str, Any]) -> ToolOutcome:
        r = a["reason"].strip()
        return ToolOutcome(True, "Noted. The run stops and a human will look at it.", summary=f"[give_up: {r[:80]}]",
                           end=EndSignal("needs_attention", "give_up", summary=r))

    S = {"type": "string"}
    kind_enum = namespaces
    reg.add(Tool("search_assets", "Search the asset library. Returns id, title, one-line description, markers and tags (never the whole index).",
                 _obj({"query": {**S, "description": "words to look for in id/title/description/tags"},
                       "kind": {**S, "enum": kind_enum, "description": "asset family: " + ", ".join(kind_enum)},
                       "tag": S, "limit": {"type": "integer", "minimum": 1, "maximum": 30}}), search_assets, read_only=True))
    reg.add(Tool("get_asset", "Full metadata of one asset: params with types and defaults, anchors, markers, bounds, duration, holds, example call.",
                 _obj({"id": S}, ["id"]), get_asset, read_only=True))
    reg.add(Tool("get_beat_info", "The beat's words with ids and beat-local seconds, duration, direction, mode, bible, neighbours and media ids.",
                 _obj({}), get_beat_info, read_only=True))
    reg.add(Tool("write_scene", "Save a new scene.js version (the complete module source) and run the fast check on it. Returns the findings.",
                 _obj({"source": {**S, "description": "complete JavaScript source of scene.js, no markdown fence"}, "note": {**S, "description": "optional: what changed"}},
                      ["source"]), write_scene))
    reg.add(Tool("check_scene", "Re-run the engine check on the current scene. level=full adds text bounds, overlap, frozen frames and determinism; run it before finish.",
                 _obj({"level": {**S, "enum": ["fast", "full"]}}, ["level"]), check_scene))
    reg.add(Tool("preview", "Render the current scene to images: the default contact strip, or up to 4 frames at beat-local seconds. Look at them.",
                 _obj({"times": {"type": "array", "items": {"type": "number"}, "maxItems": 4, "description": "beat-local seconds"}}), preview))
    reg.add(Tool("get_markers", "Run the scene's markers(rt) and list [{id, t, kind}]. The cue anchors sounds to these ids.", _obj({}), get_markers))
    reg.add(Tool("revert_scene", "Make an older scene version current again.", _obj({"n": {"type": "integer", "minimum": 1}}, ["n"]), revert_scene))
    if ctx.req.sfx_enabled:
        reg.add(Tool("write_cue", "Save a new cue.py version (complete Python source), render it and run the audio check. Returns the A-code findings and metrics.",
                     _obj({"source": {**S, "description": "complete Python source of cue.py, no markdown fence"}, "note": S}, ["source"]), write_cue))
        reg.add(Tool("revert_cue", "Make an older cue version current again.", _obj({"n": {"type": "integer", "minimum": 1}}, ["n"]), revert_cue))
    reg.add(Tool("finish", "Run the full pipeline (full check, video, audio, mux, verify) on the current scene and cue. If everything passes the run ends "
                           "and a human reviews it; otherwise you get the failing stage and its findings.",
                 _obj({"summary": {**S, "description": "1-3 sentences for the human reviewer: what the beat shows and any decision you made"}}, ["summary"]), finish))
    reg.add(Tool("ask_user", "Ask the human reviewer a question and pause. Use sparingly: prefer making a good decision and noting it in finish.summary.",
                 _obj({"question": S}, ["question"]), ask_user))
    reg.add(Tool("give_up", "Stop because you cannot make progress. A human will look at the run.", _obj({"reason": S}, ["reason"]), give_up))
    return reg
