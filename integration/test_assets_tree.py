"""Requirement 5: indexing and checking tools work on the merged tree, pick up modules that arrive later, and fail loudly on id collisions.

The 'arrival' of a new asset zip (story assets: people/*, env/*, story/*) is simulated on a throw-away copy of the library."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import helpers
from helpers import ASSETS, REPO, child_env

from vbeat_shared import assets as sa

MODULE = '''/**
 * Synthetic asset module used by integration/test_assets_tree.py. Exports: assets.
 */
import { PAPER, INK, W, H } from '../core/palette.js';
const meta = { id: '%(id)s', kind: 'scene', mode: 'story', title: 'Test card', description: 'Synthetic asset for the drop-in test.', duration: 3,
  holds: true, params: {}, anchors: {}, markers: ['pop'], tags: ['test'], bounds: [0, 0, W, H], origin: [0, 0],
  example: "assets['%(id)s'].draw(g, t, {})" };
export const assets = { '%(id)s': { meta,
  draw(g, t) { g.fillStyle = PAPER; g.fillRect(0, 0, W, H); g.fillStyle = INK; g.fillRect(100, 100, 200 + 50 * t, 80); },
  markers() { return [{ id: 'hit', t: 1, kind: 'pop' }]; } } };
'''


def library_copy(tmp_path: Path) -> Path:
    """assets/ + tools/ of the real library, the way an unzip of a second asset zip would sit next to them."""
    lib = tmp_path / "motion-assets"
    shutil.copytree(ASSETS, lib / "assets")
    shutil.copytree(REPO / "motion-assets" / "tools", lib / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    return lib


def add_module(lib: Path, rel: str, asset_id: str):
    p = lib / "assets" / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(MODULE % {"id": asset_id})


def codes(lib: Path) -> set[str]:
    return {p.code for p in sa.check_tree(lib / "assets") if p.level == "error"}


def test_the_merged_library_is_consistent():
    assert sa.check_tree(ASSETS) == []
    mods = sa.read_manifest(ASSETS)
    assert mods == sa.discover_modules(ASSETS) and len(mods) == 7
    assert sa.list_asset_modules(ASSETS)["modules"] == mods


def test_a_dropped_in_module_that_is_not_indexed_yet_is_reported_not_silently_ignored(tmp_path):
    lib = library_copy(tmp_path)
    add_module(lib, "people/test-card.js", "people/test-card")
    assert {"STALE_MANIFEST", "STALE_INDEX"} <= codes(lib)
    msg = " ".join(str(p) for p in sa.check_tree(lib / "assets"))
    assert "people/test-card.js" in msg and "make index" in msg
    r = subprocess.run([sys.executable, str(REPO / "scripts/check_assets.py"), "--assets", str(lib / "assets")], capture_output=True, text=True, env=child_env())
    assert r.returncode == 1 and "STALE_MANIFEST" in r.stdout


def test_a_second_copy_of_the_core_is_an_error(tmp_path):
    lib = library_copy(tmp_path)
    (lib / "assets" / "people").mkdir()
    shutil.copyfile(lib / "assets" / "core" / "core.js", lib / "assets" / "people" / "core.js")
    assert "DUPLICATE_CORE" in codes(lib)


def test_an_id_declared_in_two_modules_is_found_statically(tmp_path):
    lib = library_copy(tmp_path)
    add_module(lib, "people/test-card.js", "people/test-card")
    add_module(lib, "env/test-card-again.js", "people/test-card")
    assert "ID_COLLISION" in codes(lib)


def test_unregistered_namespace_and_bad_marker_kind_are_errors(tmp_path):
    lib = library_copy(tmp_path)
    add_module(lib, "zzz/mod.js", "zzz/thing")
    sa.write_manifest(lib / "assets")
    idx = json.loads((lib / "assets" / "index.json").read_text())
    idx["modules"] = sa.read_manifest(lib / "assets")
    idx["assets"].append({"id": "zzz/thing", "kind": "scene", "description": "d", "params": {}, "markers": ["boing"], "module": "zzz/mod.js"})
    idx["count"] = len(idx["assets"])
    (lib / "assets" / "index.json").write_text(json.dumps(idx))
    assert {"UNKNOWN_NAMESPACE", "BAD_MARKER_KIND"} <= codes(lib)


@pytest.mark.render
def test_rerunning_the_index_tool_picks_up_new_modules_and_a_collision_fails_loudly(tmp_path):
    lib = library_copy(tmp_path)
    tool = [sys.executable, str(lib / "tools" / "build_index.py")]
    # 1. a new module arrives
    add_module(lib, "people/test-card.js", "people/test-card")
    r = subprocess.run(tool, capture_output=True, text=True, env=child_env(), cwd=lib)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "people/test-card.js" in sa.read_manifest(lib / "assets")
    idx = json.loads((lib / "assets" / "index.json").read_text())
    assert "people/test-card" in {a["id"] for a in idx["assets"]} and idx["count"] == len(idx["assets"])
    assert codes(lib) == set(), sa.check_tree(lib / "assets")
    assert "people/test-card.js" in sa.list_asset_modules(lib / "assets")["modules"]     # what the engine's page will import
    # 2. the same id arrives again from another module: loud, non-zero
    add_module(lib, "env/test-card-again.js", "people/test-card")
    r = subprocess.run(tool, capture_output=True, text=True, env=child_env(), cwd=lib)
    assert r.returncode == 1 and "DUPLICATE id people/test-card" in r.stdout, r.stdout
    assert "ID_COLLISION" in codes(lib)
