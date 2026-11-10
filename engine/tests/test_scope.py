import ast
import re
import subprocess
import sys

from helpers import ROOT

SHARED_SRC = ROOT.parent / "shared" / "src"   # vbeat_shared lives in ../shared in the merged repo
SHARED = SHARED_SRC / "vbeat_shared"


def test_shared_imports_only_the_stdlib_by_inspection():
    stdlib = set(sys.stdlib_module_names)
    for path in SHARED.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mods = [] if node.level else [node.module or ""]
            else:
                continue
            for m in mods:
                assert m.split(".")[0] in stdlib, f"{path.name} imports non-stdlib {m}"


def test_shared_imports_under_a_restricted_import_hook():
    code = r"""
import sys
class Block:
    allowed = set(sys.stdlib_module_names) | {"vbeat_shared"}
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] not in self.allowed:
            raise ImportError("blocked non-stdlib import: " + name)
before = set(sys.modules)
sys.meta_path.insert(0, Block())
import vbeat_shared.timeline, vbeat_shared.ingest
from vbeat_shared.ingest import parse_transcript
t = parse_transcript('{"words":[{"text":"hi","start_ms":0,"end_ms":100}]}', 30)
assert t.words[0].id == "w0001"
loaded = {m.split(".")[0] for m in set(sys.modules) - before} - set(sys.stdlib_module_names) - {"vbeat_shared"}
assert not loaded, loaded
print("ok")
"""
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env={"PYTHONPATH": str(SHARED_SRC)})
    assert p.returncode == 0 and p.stdout.strip() == "ok", p.stderr


def test_no_out_of_scope_references():
    banned = re.compile("|".join(["open" + "router", "supa" + "base", "fly" + r"\.io", r"on" + "render", "render" + r"\.com",
                                  r"\bsprites\b", r"\baud" + "io", r"\bllm\b"]), re.I)
    skip = {"acorn.mjs"}
    hits = []
    for path in list(ROOT.rglob("*")):
        if (not path.is_file() or path.name in skip or "__pycache__" in path.parts or ".git" in path.parts
                or path.suffix in {".png", ".jpg", ".mp4", ".pyc"} or path.name == "test_scope.py"):
            continue
        for n, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
            if banned.search(line):
                hits.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()[:80]}")
    assert not hits, "\n".join(hits)


def test_layout_matches_the_spec():
    for rel in ["pyproject.toml", "src/vbeat_shared/timeline.py", "src/vbeat_shared/ingest.py", "runtime/runtime.js",
                "runtime/harness.html", "runtime/harness.js", "runtime/page-checks.js", "runtime/contact-sheet.js",
                "runtime/lint.js", "assets/README.md", "scripts/setup_sprite.sh", "docs/INTERFACES.md", "docs/DECISIONS.md",
                *[f"src/vbeat_sprite/{n}.py" for n in ("api", "spec", "server", "browser", "render", "checks", "ffmpeg", "cli", "__main__")]]:
        base = ROOT.parent / "shared" if rel.startswith("src/vbeat_shared/") else ROOT
        assert (base / rel).is_file(), rel
    assert any((ROOT / "runtime" / "vendor").glob("acorn.*"))
    assert [p.name for p in (ROOT / "assets").iterdir()] == ["README.md"]
    assert len((ROOT / "docs" / "INTERFACES.md").read_text().splitlines()) <= 150
