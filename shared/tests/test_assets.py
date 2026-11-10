import json

from vbeat_shared import assets as sa

CORE = "export const PAPER = '#fff';\n"
MOD = "/** m */\nexport const assets = {\n  '%s': { meta: {}, draw() {} },\n};\n"


def library(tmp_path, ids=None, *, index=True):
    root = tmp_path / "assets"
    (root / "core").mkdir(parents=True)
    (root / "core" / "core.js").write_text(CORE)
    (root / "core" / "palette.js").write_text(CORE)
    (root / "technical").mkdir()
    for i, aid in (ids or {"technical/a.js": "tech/a", "technical/b.js": "tech/b"}).items():
        (root / i).write_text(MOD % aid)
    mods = sa.write_manifest(root)
    if index:
        entries = [{"id": a, "kind": "scene", "description": "d", "params": {}, "markers": ["pop"], "module": m}
                   for m, a in (ids or {"technical/a.js": "tech/a", "technical/b.js": "tech/b"}).items()]
        (root / "index.json").write_text(json.dumps({"version": 1, "count": len(entries), "modules": mods, "assets": entries}))
    return root


def test_discovery_skips_core_dev_dotdirs_and_modules_without_an_assets_export(tmp_path):
    root = library(tmp_path)
    (root / "technical" / "kit.js").write_text("export const helper = 1;\n")
    (root / "_dev").mkdir(); (root / "_dev" / "x.js").write_text(MOD % "tech/z")
    (root / ".hidden").mkdir(); (root / ".hidden" / "y.js").write_text(MOD % "tech/w")
    (root / "technical" / "commented.js").write_text("// export const assets = {}\nexport const x = 1;\n")
    assert sa.discover_modules(root) == ["technical/a.js", "technical/b.js"]


def test_manifest_round_trip_and_the_page_module_list(tmp_path):
    root = library(tmp_path)
    assert sa.read_manifest(root) == ["technical/a.js", "technical/b.js"]
    info = sa.list_asset_modules(root)
    assert info == {"modules": ["technical/a.js", "technical/b.js"], "fonts_css": False, "source": "manifest"}
    (root / "manifest.json").unlink()
    assert sa.list_asset_modules(root)["source"] == "glob"


def test_safe_join_refuses_escapes(tmp_path):
    root = library(tmp_path)
    (tmp_path / "secret.txt").write_text("s")
    assert sa.safe_join(root, "technical/a.js")
    for bad in ("../secret.txt", "technical/../../secret.txt", "/etc/passwd", "a\\b", "x\x00", "", "technical"):
        assert sa.safe_join(root, bad) is None, bad


def test_a_consistent_library_has_no_problems(tmp_path):
    assert sa.check_tree(library(tmp_path)) == []


def test_new_module_without_reindex_is_stale_not_silent(tmp_path):
    root = library(tmp_path)
    (root / "technical" / "c.js").write_text(MOD % "tech/c")
    assert {p.code for p in sa.check_tree(root)} >= {"STALE_MANIFEST", "STALE_INDEX"}


def test_collisions_are_found_in_sources_and_in_the_index(tmp_path):
    root = library(tmp_path, {"technical/a.js": "tech/a", "technical/b.js": "tech/a"})
    assert "ID_COLLISION" in {p.code for p in sa.check_tree(root)}
    root2 = library(tmp_path / "two")
    idx = json.loads((root2 / "index.json").read_text())
    idx["assets"].append(dict(idx["assets"][0])); idx["count"] += 1
    (root2 / "index.json").write_text(json.dumps(idx))
    assert "ID_COLLISION" in {p.code for p in sa.check_tree(root2)}


def test_namespaces_and_marker_kinds_are_checked(tmp_path):
    root = library(tmp_path, {"technical/a.js": "zzz/a"})
    assert "UNKNOWN_NAMESPACE" in {p.code for p in sa.check_tree(root)}
    root = library(tmp_path / "b", {"technical/a.js": "Tech/A"})
    assert "BAD_ID" in {p.code for p in sa.check_tree(root)}
    root = library(tmp_path / "c")
    idx = json.loads((root / "index.json").read_text()); idx["assets"][0]["markers"] = ["boing"]
    (root / "index.json").write_text(json.dumps(idx))
    assert "BAD_MARKER_KIND" in {p.code for p in sa.check_tree(root)}


def test_missing_core_and_second_core_copy(tmp_path):
    root = library(tmp_path)
    (root / "technical" / "core.js").write_text(CORE)
    assert "DUPLICATE_CORE" in {p.code for p in sa.check_tree(root)}
    (root / "core" / "palette.js").unlink()
    assert "MISSING_CORE" in {p.code for p in sa.check_tree(root)}


def test_every_registered_namespace_is_described():
    assert {"tech", "obj", "fx", "people", "env", "story"} == set(sa.NAMESPACES)
