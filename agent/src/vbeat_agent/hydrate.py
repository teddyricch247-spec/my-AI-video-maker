"""Rebuild a beat directory from stored data, and read a version back out of one. Pure functions: no database, no network.

A backend that keeps every run's data in a database (workers whose disks are scratch) calls `rebuild_beat_dir` on any machine to get
exactly the files the runner expects, then `continue_beat` carries on from the stored conversation. `read_version_bundle` is the
other direction: it returns one version in the shape a database row needs, so the backend never hard-codes the file layout.

Input shapes (all plain dicts, JSON-serialisable):
    request          BeatRequest.to_dict(); `beat_dir` is overwritten with the directory being built
    state            the state.json dict (underscore keys are dropped; `pid` is cleared: the process that wrote it is gone)
    messages         conversation.jsonl lines in order: the raw messages with their `_meta` key
    scene_versions   [{n, source|code, report|checks, meta?}]       (`created_by` / `created_at` at the top level fill in `meta`)
    sfx_versions     [{n, source|code, report|checks, meta?}]       `report` is the whole cue report (including `metrics`)
Binary artefacts (strips, wavs, spectrogram images) and derived files (final.mp4, markers.json, report.json) are not rebuilt: nothing in
the runner needs an old one to continue, and the state's claims about them (`final_video`, `markers_n`, `full_ok_n`) are cleared so the
runner regenerates them. The caller supplies `transcript.json` (and any media) in the directory itself.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from .state import BeatPaths, StateStore, VersionStore, copy_atomic, now_iso, read_json, write_json_atomic, write_text_atomic

__all__ = ["rebuild_beat_dir", "read_version_bundle"]

_KINDS = {"scene": "scene", "cue": "cue", "sfx": "cue"}


def _norm_kind(kind: str) -> str:
    try:
        return _KINDS[kind]
    except KeyError:
        raise ValueError(f"kind must be 'scene' or 'cue' (or 'sfx'), got {kind!r}") from None


def _source(v: dict[str, Any]) -> str:
    src = v.get("source")
    if src is None:
        src = v.get("code")
    return src if src is not None else ""


def _report(v: dict[str, Any]) -> dict[str, Any] | None:
    rep = v.get("report")
    return rep if rep is not None else v.get("checks")


def _meta(v: dict[str, Any], n: int, source: str) -> dict[str, Any]:
    m = dict(v.get("meta") or {})
    created_at = m.get("created_at") or v.get("created_at")
    return {"n": n, "created_at": str(created_at) if created_at else now_iso(), "created_by": m.get("created_by") or v.get("created_by") or "agent",
            "note": m.get("note", ""), "bytes": len(source.encode("utf-8")), "step": m.get("step", 0), **{k: x for k, x in m.items() if k not in ("n",)}}


def rebuild_beat_dir(beat_dir: "str | Path", *, request: dict[str, Any], state: dict[str, Any], messages: list[dict[str, Any]],
                     scene_versions: Iterable[dict[str, Any]], sfx_versions: Iterable[dict[str, Any]]) -> BeatPaths:
    """Write agent/request.json, agent/state.json, agent/conversation.jsonl, versions/scene_NNN.js(+.check.json, .meta.json),
    versions/cue_NNN.py(+.report.json, .meta.json), then scene.js / cue.py as copies of the current versions. Returns the BeatPaths.

    The current versions are the ones `state.scene_n` / `state.sfx_n` name. If the state names a version that was never stored (the
    state is mirrored at most once a second, so it can lag) or names none, the highest stored version is used and the state is
    corrected to match. Existing files in `beat_dir` are overwritten; run it on an empty directory."""
    paths = BeatPaths(beat_dir).ensure()
    req = dict(request)
    req["beat_dir"] = str(paths.dir)
    write_json_atomic(paths.request, req)

    # conversation: one JSON object per line, `_meta` kept (the runner's context compaction is reproducible from it)
    lines = [json.dumps(m, ensure_ascii=False, default=str) for m in messages]
    write_text_atomic(paths.conversation, ("\n".join(lines) + "\n") if lines else "")

    stored: dict[str, list[int]] = {"scene": [], "cue": []}
    for v in scene_versions:
        n, src = int(v["n"]), _source(v)
        paths.scene_version(n).write_text(src, encoding="utf-8")
        rep = _report(v)
        if rep is not None:
            write_json_atomic(paths.scene_check(n), rep)
        write_json_atomic(paths.scene_meta(n), _meta(v, n, src))
        stored["scene"].append(n)
    for v in sfx_versions:
        n, src = int(v["n"]), _source(v)
        paths.cue_version(n).write_text(src, encoding="utf-8")
        rep = _report(v)
        if rep is not None:
            write_json_atomic(paths.cue_report(n), rep)
        write_json_atomic(paths.cue_meta(n), _meta(v, n, src))
        stored["cue"].append(n)

    st = {k: v for k, v in dict(state).items() if not k.startswith("_")}
    st["pid"] = None
    st["final_video"] = st["markers_n"] = st["full_ok_n"] = None     # derived files (final.mp4, markers.json, reports) are not rebuilt: do not claim them
    for kind, key in (("scene", "scene_n"), ("cue", "sfx_n")):
        have = sorted(stored[kind])
        want = st.get(key)
        if have and (want is None or want not in have):
            st[key] = have[-1]
        elif not have:
            st[key] = None
    write_json_atomic(paths.state, st)

    for kind, key, dst, src_of in (("scene", "scene_n", paths.scene, paths.scene_version), ("cue", "sfx_n", paths.cue, paths.cue_version)):
        n = st.get(key)
        if n:
            copy_atomic(src_of(int(n)), dst)
    return paths


def read_version_bundle(beat_dir: "str | Path", kind: str, n: int) -> dict[str, Any]:
    """One version of a beat as plain data: {n, source, report, meta, strip_path, wav_path, spectrogram_path}.
    `kind` is 'scene' or 'cue' ('sfx' is accepted for 'cue'). The three *_path values are Paths of files that exist, else None
    (a scene has a strip only; a cue has a wav and a spectrogram only). `source` is None if the version file does not exist."""
    k = _norm_kind(kind)
    paths = BeatPaths(beat_dir)
    n = int(n)
    if k == "scene":
        src_p, rep_p, meta_p = paths.scene_version(n), paths.scene_check(n), paths.scene_meta(n)
        strip, wav, spec = paths.scene_strip(n), None, None
    else:
        src_p, rep_p, meta_p = paths.cue_version(n), paths.cue_report(n), paths.cue_meta(n)
        strip, wav, spec = None, paths.cue_wav(n), paths.cue_preview(n)

    def existing(p: Path | None) -> Path | None:
        return p if p is not None and p.exists() else None

    return {"n": n, "source": src_p.read_text(encoding="utf-8") if src_p.exists() else None, "report": read_json(rep_p),
            "meta": read_json(meta_p, {}) or {}, "strip_path": existing(strip), "wav_path": existing(wav), "spectrogram_path": existing(spec)}
