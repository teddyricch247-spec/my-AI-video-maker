"""Examples, catalog, docs, selftest, performance and repo hygiene."""
import re
import subprocess
import sys
import time

import numpy as np
import pytest

import helpers
from vbeat_audio import analysis, api, catalog, docs
from vbeat_audio import synth as S

ROOT = helpers.ROOT


def test_seven_examples_exist_with_specs_and_are_short():
    assert helpers.EXAMPLES == sorted(["stat_land", "flow_pops", "checklist", "title_stamp", "story_market", "minimal", "type_code"])
    for n in helpers.EXAMPLES:
        src = (ROOT / "sfx" / "examples" / f"{n}.py").read_text()
        assert len(src.splitlines()) <= 40 and src.lstrip().startswith("#")  # a comment explains the choices
        assert (helpers.FIX / "specs" / f"{n}.json").exists()


@pytest.mark.parametrize("name", helpers.EXAMPLES)
def test_example_has_no_findings_above_info(name, tmp_path):
    env = helpers.render_file(ROOT / "sfx" / "examples" / f"{name}.py", name, tmp_path)
    r = env["report"]
    assert env["ok"] and r["counts"] == {"error": 0, "warn": 0} and r["ok"], r["text"]
    assert "wav" in env["artifacts"] and "preview" in env["artifacts"]


def test_fixture_specs_match_the_engine_inputs():
    from vbeat_audio.spec import build_spec, load_json
    for n in helpers.EXAMPLES + ["base5"]:
        e = helpers.FIX / "engine"
        assert build_spec(load_json(e / f"{n}.beat.json"), load_json(e / f"{n}.markers.json")) == helpers.spec(n)


def test_every_recipe_passes_the_checks_without_findings_above_info():
    for name, fn in S.RECIPES.items():
        rep = catalog.check_recipe(fn())
        assert rep["counts"] == {"error": 0, "warn": 0}, (name, rep["text"])


def test_catalog_builds_everything(tmp_path):
    env = api.catalog(tmp_path / "demo")
    assert env["ok"] and env["report"]["ok"] and env["report"]["counts"] == {"error": 0, "warn": 0}, env
    for name in S.RECIPES:
        assert (tmp_path / "demo" / "recipes" / f"{name}.wav").exists()
        assert helpers.read_wav(tmp_path / "demo" / "recipes" / f"{name}.wav")[4].max() > 0
    assert (tmp_path / "demo" / "recipes" / "_catalog.jpg").stat().st_size > 10000
    for n in helpers.EXAMPLES:
        assert (tmp_path / "demo" / "examples" / f"{n}.wav").exists() and (tmp_path / "demo" / "examples" / f"{n}.jpg").exists()
    page = (tmp_path / "demo" / "audition.html").read_text()
    assert page.count("<audio") == len(S.RECIPES) + len(helpers.EXAMPLES) and "innerHTML" not in page
    assert not re.search(r'(src|href)="(https?:)?//', page) and "<script" not in page  # no external resources
    for n in list(S.RECIPES) + helpers.EXAMPLES:
        assert n in page
    wav = helpers.read_wav(tmp_path / "demo" / "recipes" / "soft_pop.wav")[4]
    assert abs(20 * np.log10(np.abs(wav).max() / 32767.0) + 6.0) < 0.01  # recipes normalised at -6 dBFS


def test_synth_api_doc_is_not_stale():
    committed = (ROOT / "sfx" / "SYNTH_API.md").read_text()
    assert committed == docs.generate(), "SYNTH_API.md is stale: run python -m vbeat_audio docs"
    assert len(committed.splitlines()) <= 150
    assert api.docs(check=True)["report"]["ok"]


def test_style_and_interface_docs_respect_their_line_limits():
    assert len((ROOT / "sfx" / "sfx-style.md").read_text().splitlines()) <= 120
    assert len((ROOT / "docs" / "AUDIO_INTERFACES.md").read_text().splitlines()) <= 150
    style = (ROOT / "sfx" / "sfx-style.md").read_text()
    for kind, recipe in (("pop", "soft_pop"), ("tick", "pen_tick"), ("whoosh", "swoosh"), ("thud", "wood_thunk"),
                         ("stamp", "stamp"), ("slide", "paper_slide"), ("chime", "chime"), ("rustle", "cloth_rustle")):
        assert f"{kind}->{recipe}" in style.replace(" ", "")
    assert (ROOT / "docs" / "DECISIONS.md").exists() and (ROOT / "DEPENDENCIES.txt").exists()


def test_selftest_passes_in_under_30_seconds():
    t = time.time()
    env = api.selftest()
    assert env["ok"] and env["report"]["ok"], env["report"]["text"]
    assert time.time() - t < 30.0


def test_cli_prints_exactly_one_json_object(tmp_path):
    import json
    base = [sys.executable, "-m", "vbeat_audio"]
    env = {"PYTHONPATH": str(ROOT / "src"), "PATH": "/usr/bin:/bin"}
    r = subprocess.run(base + ["spec", "--beat", str(helpers.FIX / "engine/minimal.beat.json"),
                               "--markers", str(helpers.FIX / "engine/minimal.markers.json"), "--out", str(tmp_path / "s.json")],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0 and len(r.stdout.strip().splitlines()) == 1
    j = json.loads(r.stdout)
    assert j["ok"] and j["command"] == "spec" and set(j) == {"ok", "command", "artifacts", "report", "timing_ms", "error"}
    r = subprocess.run(base + ["render", "--spec", str(tmp_path / "s.json"), "--cue", str(ROOT / "sfx/examples/minimal.py"),
                               "--out", str(tmp_path / "o")], capture_output=True, text=True, env=env)
    j = json.loads(r.stdout)
    assert r.returncode == 0 and len(r.stdout.strip().splitlines()) == 1 and j["report"]["ok"] and "sandbox" in r.stderr
    r = subprocess.run(base + ["render", "--spec", str(tmp_path / "s.json"), "--cue", str(helpers.bad("a0_import_os")),
                               "--out", str(tmp_path / "o2")], capture_output=True, text=True, env=env)
    assert r.returncode == 1 and json.loads(r.stdout)["report"]["ok"] is False
    r = subprocess.run(base + ["render", "--spec", str(tmp_path / "nope.json"), "--cue", "x.py", "--out", str(tmp_path)],
                       capture_output=True, text=True, env=env)
    j = json.loads(r.stdout)
    assert r.returncode == 2 and j["ok"] is False and j["error"]["type"] == "SpecError"
    r = subprocess.run(base + ["bogus"], capture_output=True, text=True, env=env)
    assert r.returncode == 2 and json.loads(r.stdout)["error"]["type"] == "UsageError"


def test_performance_typical_8s_beat_with_10_cues(tmp_path):
    spec = {"fps": 30, "frames": 240, "samples": 384000, "dur": 8.0, "words": [{"id": "w1", "start": 1.0, "end": 1.4}],
            "markers": [{"id": "m1", "t": 2.0, "kind": "thud"}], "peak_dbfs": -6.0, "seed": 0}
    src = ("from synth import *\ndef render(ctx):\n    m = ctx.mix()\n    for i in range(10):\n"
           "        m.add(0.4 + 0.75 * i, [soft_pop, pen_tick, wood_thunk, swoosh, chime][i % 5](), gain_db=-4, name=f'c{i}')\n"
           "    return m.render()\n")
    api.render(spec, None, tmp_path / "warm", source=src)  # warm file caches like a long-running host would
    runs = []
    for i in range(3):  # best of three: the child's numpy+scipy import dominates and is noisy on a busy machine
        t = time.time()
        env = api.render(spec, None, tmp_path / f"run{i}", source=src)
        runs.append((time.time() - t, env))
    wall, env = min(runs, key=lambda r: r[0])
    assert env["ok"] and wall < 2.0, [round(r[0], 2) for r in runs]
    assert env["timing_ms"]["checks"] + env["timing_ms"]["preview"] < 1000
    assert len(env["artifacts"]) == 4


def test_no_other_vbeat_package_is_imported_and_scope_is_respected():
    for p in (ROOT / "src" / "vbeat_audio").glob("*.py"):
        text = p.read_text()
        assert not re.search(r"(?m)^\s*(from|import)\s+vbeat(?!_audio)\b", text), p
        assert not re.search(r"(?im)openrouter|supabase|sprites|lufs|signed url|manifest|volume slider", text), p
    # the package must also import cleanly with only its own dependencies
    r = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import vbeat_audio.api, vbeat_audio.cli; "
                        "print(sorted(m for m in sys.modules if m.startswith('vbeat') and not m.startswith('vbeat_audio')))" % str(ROOT / "src")],
                       capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == "[]", r.stderr


def test_dependencies_file_lists_each_package_once():
    lines = [l for l in (ROOT / "DEPENDENCIES.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
    names = [re.split(r"[<>=\s]", l)[0].lower() for l in lines]
    assert len(names) == len(set(names)) and {"numpy", "scipy", "pillow", "pytest", "ffmpeg"} <= set(names)
    assert all(re.search(r">=\s*\d", l) for l in lines)


def test_commands_that_need_the_checkout_fail_loudly_without_it():
    from pathlib import Path
    original = api.REPO
    catalog_original = catalog.REPO
    api.REPO = catalog.REPO = Path("/nonexistent/checkout")
    try:
        for env in (api.catalog("/tmp/never_written"), api.selftest(), api.docs()):
            assert (env["ok"] is False and env["error"]) or env["report"]["ok"] is False, env
        assert api.docs(check=True)["ok"] is False
    finally:
        api.REPO, catalog.REPO = original, catalog_original
