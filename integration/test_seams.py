"""Seams between the four pieces that were built in isolation. Each test fails when one side drifts from the other.
Fast: no browser (the browser seam is integration/test_preview_seam.py)."""
import json
import re
import subprocess
import sys

import pytest

import helpers
from helpers import ASSETS, REPO, cli, spec_only_beat

from vbeat_shared import envelope as env_mod
from vbeat_shared import preview as pv
from vbeat_shared import timeline
from vbeat_shared.markers import MARKER_KINDS


# ------------------------------------------------------------------ marker kinds: one list, five literal copies
def test_every_copy_of_the_marker_kind_list_equals_the_shared_one():
    from vbeat_audio import constants as audio_const
    assert tuple(audio_const.MARKER_KINDS) == MARKER_KINDS
    js = (REPO / "engine/runtime/runtime.js").read_text()
    m = re.search(r"export const MARKER_KINDS = \[(.*?)\]", js)
    assert tuple(re.findall(r"'(\w+)'", m.group(1))) == MARKER_KINDS
    tool = (REPO / "motion-assets/tools/check.py").read_text()
    m = re.search(r"^KINDS = \{(.*?)\}", tool, re.M)
    assert set(re.findall(r"'(\w+)'", m.group(1))) == set(MARKER_KINDS)
    for a in json.loads((ASSETS / "index.json").read_text())["assets"]:
        assert set(a["markers"]) <= set(MARKER_KINDS), a["id"]


# ------------------------------------------------------------------ time model: one source, audio keeps a pinned copy
def test_audio_time_constants_are_pinned_to_the_shared_time_model():
    from vbeat_audio import constants as c
    assert c.SR == timeline.SAMPLE_RATE and tuple(c.ALLOWED_FPS) == timeline.ALLOWED_FPS
    for frames in (1, 29, 30, 121, 1800):
        for fps in timeline.ALLOWED_FPS:
            assert c.samples_for(frames, fps) == timeline.samples_for_frames(frames, fps), (frames, fps)


def test_frontend_offers_exactly_the_frame_rates_and_sizes_the_time_model_allows():
    js = (REPO / "frontend/web/js/pages/projects.js").read_text()
    sizes = tuple(tuple(int(x) for x in m) for m in re.findall(r"\[(\d+), (\d+)\]", re.search(r"const SIZES = \[(.*?)\];", js).group(1)))
    assert sizes == timeline.EXPORT_SIZES
    fps = tuple(int(x) for x in re.search(r"\[((?:\d+, ?)+\d+)\]\.map", js).group(1).split(","))
    assert fps == timeline.ALLOWED_FPS


def test_audio_spec_built_from_a_real_engine_spec_has_the_exact_sample_count():
    beat = spec_only_beat()
    rc, e = cli("vbeat_audio", "spec", "--beat", beat / "spec.json", "--out", beat / "sfx_spec.json")
    assert rc == 0 and e["ok"] and not env_mod.validate_envelope(e), e
    spec = json.loads((beat / "sfx_spec.json").read_text())
    engine = json.loads((beat / "spec.json").read_text())
    frames = engine["beat"]["f1"] - engine["beat"]["f0"]
    assert spec["frames"] == frames and spec["samples"] == timeline.samples_for_frames(frames, engine["project"]["fps"])
    # words are re-based to beat-local seconds and keep their engine ids
    assert [w["id"] for w in spec["words"]] == [w["id"] for w in engine["words"]]
    # ms is the ingest source of truth, frames its derived grid; audio places words on that grid: (word.f0 - beat.f0) / fps
    for sw, ew in zip(spec["words"], engine["words"]):
        assert abs(sw["start"] - (ew["f0"] - engine["beat"]["f0"]) / 30) < 1e-5 and abs(sw["end"] - (ew["f1"] - engine["beat"]["f0"]) / 30) < 1e-5


# ------------------------------------------------------------------ envelopes and reports
def test_real_commands_print_valid_envelopes_and_failures_classify_correctly():
    beat = spec_only_beat()
    rc, e = cli("vbeat_sprite", "spec", "--transcript", helpers.TRANSCRIPT, "--fps", 30, "--from-word", 0, "--to-word", 99,
                "--scene", beat / "scene.js", "--assets", ASSETS, "--out", beat / "bad")
    assert rc != 0 and not e["ok"] and not env_mod.validate_envelope(e)
    assert env_mod.classify(e) is env_mod.Outcome.TOOL_FAILED
    rc, e = cli("vbeat_audio", "spec", "--beat", beat / "no_such.json", "--out", beat / "x.json")
    assert rc != 0 and not env_mod.validate_envelope(e) and env_mod.classify(e) is env_mod.Outcome.TOOL_FAILED


def test_a_failed_audio_report_is_a_valid_check_report_and_classifies_as_report_failed():
    beat = spec_only_beat()
    cli("vbeat_audio", "spec", "--beat", beat / "spec.json", "--out", beat / "sfx_spec.json")
    bad = beat / "bad_cue.py"
    bad.write_text("from synth import *\n\ndef render(ctx):\n    raise ValueError('boom')\n")
    rc, e = cli("vbeat_audio", "render", "--spec", beat / "sfx_spec.json", "--cue", bad, "--out", beat / "bad_sfx")
    assert not env_mod.validate_envelope(e)
    assert not env_mod.validate_check_report(e["report"]), env_mod.validate_check_report(e["report"])
    assert e["ok"] is True and e["report"]["ok"] is False
    assert env_mod.classify(e) is env_mod.Outcome.REPORT_FAILED
    assert rc == 1, "audio exits 1 for a failed report (the engine exits 0 for a scene fault: docs/MERGE_DECISIONS.md D3)"


def test_check_report_validator_rejects_what_the_contract_forbids():
    good = {"ok": True, "counts": {"error": 0, "warn": 1}, "findings": [{"id": "C4", "severity": "warn", "message": "m"}], "text": "t"}
    assert env_mod.validate_check_report(good) == []
    assert env_mod.validate_check_report({**good, "counts": {"error": 0, "warn": 0}})
    assert env_mod.validate_check_report({**good, "findings": [{"id": "Z9", "severity": "warn", "message": "m"}]})
    assert env_mod.validate_check_report({**good, "ok": False})
    assert env_mod.check_projection({**good, "extra": 1}) == {"ok": True, "counts": {"error": 0, "warn": 1}, "text": "t"}


# ------------------------------------------------------------------ headers and CSP: one source, mock pinned to it
def test_mock_server_headers_equal_the_shared_ones_and_the_engine_csp_is_the_shared_one():
    from devserver.server import load_mock
    M = load_mock()
    assert M.CORS == pv.PREVIEW_CORS and M.FRAME_CSP == pv.FRAME_CSP
    from vbeat_sprite import server as sprite_server
    assert sprite_server.CSP == pv.RENDER_CSP


# ------------------------------------------------------------------ frontend adapter <-> engine runtime (static tripwire)
def test_adapter_uses_exactly_the_surface_the_runtime_exports():
    adapter = (REPO / "frontend/web/js/preview-adapter.js").read_text()
    runtime = (REPO / "engine/runtime/runtime.js").read_text()
    assert re.search(r"export async function createRuntime\(\{[^}]*\bsceneUrl\b", runtime)
    for token in ("createRuntime(", "sceneUrl: bundle.scene_url", "baseUrl: bundle.assets_base_url", "eng.info.", ".drawFrame(", ".markers()"):
        assert token in adapter, token
    assert re.search(r"info: \{ fps, frames, dur", runtime) and re.search(r"\bdrawFrame\b", runtime) and re.search(r"\bmarkers\b", runtime)


# ------------------------------------------------------------------ the preview bundle over HTTP (dev server, no browser)
def test_preview_bundle_for_a_real_beat_is_valid_and_leaks_no_paths():
    srv, base, real = helpers.start_devserver([spec_only_beat()])
    try:
        h = helpers.Http(base)
        h.login()
        bid = next(iter(real))
        bundle = h.json(f"/api/beats/{bid}/preview")
        assert pv.validate_bundle(bundle) == [], pv.validate_bundle(bundle)
        assert bundle["runtime_url"] == "/preview/engine/runtime/runtime.js" and bundle["assets_base_url"] == "/preview/engine/"
        assert bundle["wav_url"] is None
        assert (bundle["frames"], bundle["fps"], bundle["width"], bundle["height"]) == (121, 30, 960, 540)
        assert str(REPO) not in json.dumps(bundle)
        detail = h.json(f"/api/beats/{bid}")
        assert detail["f0"] == bundle["spec"]["beat"]["f0"] and [w["id"] for w in detail["words"]] == [w["id"] for w in bundle["spec"]["words"]]
        assert detail["words"][0]["f0"] == bundle["spec"]["words"][0]["f0"]
    finally:
        srv.shutdown()


def test_sandboxed_frame_headers_and_the_engine_url_space():
    srv, base, real = helpers.start_devserver([spec_only_beat()])
    try:
        h = helpers.Http(base)
        h.login()
        bid = next(iter(real))
        bundle = h.json(f"/api/beats/{bid}/preview")
        st, hd, body = h.req("/preview-frame.html")
        assert st == 200 and hd["Content-Security-Policy"] == pv.FRAME_CSP and "sandbox allow-scripts" in hd["Content-Security-Policy"]
        urls = [bundle["runtime_url"], bundle["assets_base_url"] + "_index.json", bundle["assets_base_url"] + "assets/core/core.js",
                bundle["assets_base_url"] + "assets/core/palette.js", bundle["assets_base_url"] + "assets/core/fonts.css", bundle["scene_url"]]
        idx = json.loads(h.req(bundle["assets_base_url"] + "_index.json")[2])
        assert idx["source"] == "manifest" and idx["fonts_css"] and "technical/scenes-a.js" in idx["modules"]
        urls += [bundle["assets_base_url"] + "assets/" + m for m in idx["modules"]]
        fonts = re.findall(r"url\(['\"]?([^)'\"]+)", h.req(bundle["assets_base_url"] + "assets/core/fonts.css")[2].decode())
        assert fonts, "fonts.css should reference font files"
        urls += [bundle["assets_base_url"] + "assets/core/" + f.lstrip("./") for f in fonts]
        for u in urls:
            st, hd, body = h.req(u)
            assert st == 200 and body, (u, st)
            for k, v in pv.PREVIEW_CORS.items():
                assert hd.get(k) == v, (u, k, hd.get(k))
        assert h.req(bundle["scene_url"])[1]["Cache-Control"] == pv.IMMUTABLE
        assert h.req(bundle["runtime_url"])[1]["Content-Type"].startswith("text/javascript")
        # only what a preview needs is served: no render-only runtime files, no traversal
        for bad in ("/preview/engine/runtime/harness.js", "/preview/engine/runtime/lint.js", "/preview/engine/assets/../../README.md",
                    "/preview/engine/assets/%2e%2e/manifest.json", "/preview/engine/scene/nope/1.js", "/preview/engine/media/%s/nope" % bid):
            assert h.req(bad)[0] == 404, bad
    finally:
        srv.shutdown()


# ------------------------------------------------------------------ the contracts document names what the code has
def test_contracts_document_mentions_every_command_header_marker_and_namespace():
    doc = (REPO / "docs/CONTRACTS.md").read_text()
    for cmd in ("ingest", "spec", "strip", "frames", "markers", "check", "video", "bench", "render", "mux", "catalog", "docs", "selftest", "render-beat"):
        assert re.search(rf"`{cmd}`", doc), f"command {cmd} is not documented"
    for k in (*MARKER_KINDS, *pv.PREVIEW_CORS, "Content-Security-Policy", "sandbox allow-scripts", "Accept-Ranges", *[f"{w}x{h}" for w, h in timeline.EXPORT_SIZES]):
        assert k in doc, f"{k} missing from docs/CONTRACTS.md"
    from vbeat_shared.assets import NAMESPACES
    for ns in NAMESPACES:
        assert f"`{ns}/*`" in doc, ns
    for n in range(1, 13):
        assert re.search(rf"^## {n}\. ", doc, re.M), f"section {n} missing"


# ------------------------------------------------------------------ the engine's stub core vs the real core
def _declarators(stmt: str) -> set[str]:
    """Names declared by `const A = 1, B = f(x, y), C = {..};` (top-level commas only)."""
    names, depth, cur, quote = set(), 0, "", None
    for ch in stmt:
        if quote:
            cur += ch
            quote = None if ch == quote else quote
            continue
        if ch in "'\"`":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            names |= set(re.findall(r"^\s*(\w+)\s*=", cur))
            cur = ""
        else:
            cur += ch
    return names | set(re.findall(r"^\s*(\w+)\s*=", cur))


def _exports(path):
    src = path.read_text()
    names = set(re.findall(r"export\s+(?:async\s+)?(?:function\*?|class)\s+(\w+)", src))
    for m in re.finditer(r"export\s+(?:const|let)\s+([^;]*);", src, re.S):
        names |= _declarators(m.group(1) if re.match(r"\s*\w+\s*=", m.group(1)) else "")
    for grp in re.findall(r"export\s*\{([^}]*)\}", src):
        names |= {x.split(" as ")[-1].strip() for x in grp.split(",") if x.strip()}
    return names


def test_the_engines_test_stub_core_exposes_nothing_the_real_core_lacks():
    stub = REPO / "engine/tests/fixtures/assets/core"
    real = ASSETS / "core"
    for f in ("core.js", "palette.js"):
        missing = _exports(stub / f) - _exports(real / f)
        assert not missing, f"stub {f} exports {sorted(missing)} that the real {f} does not: the engine's tests would pass against an API that does not exist"
