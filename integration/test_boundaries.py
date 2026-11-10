"""Requirement 6: dependency boundaries are explicit and enforced.

shared: standard library only (it runs on a 512 MB / 0.1 CPU web server).
heavy dependencies (Playwright, Chromium, numpy, scipy, Pillow, ffmpeg): render-machine code only.
web UI: no build step, no external resources. Package layering: who may import whom.
"""
import ast
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import helpers
from helpers import REPO

HEAVY = {"playwright", "numpy", "scipy", "PIL"}
HEAVY_TOOLS = re.compile(r"\b(ffmpeg|ffprobe|chromium)\b", re.I)
# directories whose code runs on the render machine (or is test/tool code that drives it)
RENDER_MACHINE = ["engine", "audio", "pipeline", "agent", "backend", "motion-assets/tools", "frontend/tests", "frontend/docs/experiments", "integration", "scripts"]
WEB_SERVER_SIDE = ["shared/src", "devserver", "frontend/mock"]
# layering: package -> the vbeat packages it may import
ALLOWED = {
    "vbeat_shared": set(),
    "vbeat_sprite": {"vbeat_shared"},
    "vbeat_audio": set(),            # frozen independent by its own test (test_no_other_vbeat_package_is_imported...)
    "vbeat_pipeline": {"vbeat_shared"},
    "vbeat_agent": {"vbeat_shared"},  # drives the engine, audio and pipeline ONLY as subprocesses
    "vbeat_backend": {"vbeat_shared", "vbeat_agent"},   # workers (and later the planner): state in Supabase; heavy tools only through vbeat_agent's subprocesses
}
PKG_DIR = {"vbeat_shared": "shared/src/vbeat_shared", "vbeat_sprite": "engine/src/vbeat_sprite", "vbeat_audio": "audio/src/vbeat_audio",
           "vbeat_pipeline": "pipeline/src/vbeat_pipeline", "vbeat_agent": "agent/src/vbeat_agent", "vbeat_backend": "backend/src/vbeat_backend"}


def py_files(*dirs, skip=()):
    for d in dirs:
        for p in sorted((REPO / d).rglob("*.py")):
            if "__pycache__" in p.parts or any(s in p.as_posix() for s in skip):
                continue
            yield p


def imported_roots(path: Path) -> set[str]:
    out = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            out.add(node.module.split(".")[0])
    return out


def test_shared_is_standard_library_only_by_declaration_and_by_inspection():
    meta = tomllib.loads((REPO / "shared" / "pyproject.toml").read_text())
    assert meta["project"]["dependencies"] == []
    stdlib = set(sys.stdlib_module_names)
    for p in py_files("shared/src"):
        bad = {m for m in imported_roots(p) if m not in stdlib and m != "vbeat_shared"}
        assert not bad, f"{p.relative_to(REPO)} imports {bad}"


def test_shared_imports_under_a_hook_that_blocks_everything_else():
    mods = sorted(p.stem for p in (REPO / "shared/src/vbeat_shared").glob("*.py") if p.stem != "__init__")
    assert {"assets", "envelope", "markers", "preview", "timeline", "ingest"} <= set(mods)
    code = (
        "import sys\n"
        "class Block:\n"
        "    allowed = set(sys.stdlib_module_names) | {'vbeat_shared'}\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        "        if name.split('.')[0] not in self.allowed: raise ImportError('blocked non-stdlib import: ' + name)\n"
        "before = set(sys.modules)\n"
        "sys.meta_path.insert(0, Block())\n"
        + "".join(f"import vbeat_shared.{m}\n" for m in mods)
        + "loaded = {m.split('.')[0] for m in set(sys.modules) - before} - set(sys.stdlib_module_names) - {'vbeat_shared'}\n"
        "assert not loaded, loaded\nprint('ok')\n")
    p = subprocess.run([sys.executable, "-S", "-c", code], capture_output=True, text=True, env={"PYTHONPATH": str(REPO / "shared/src")})
    assert p.returncode == 0 and p.stdout.strip() == "ok", p.stderr


def test_web_server_side_code_imports_no_heavy_dependency_and_calls_no_render_tool():
    for p in py_files(*WEB_SERVER_SIDE):
        assert not (imported_roots(p) & HEAVY), f"{p.relative_to(REPO)} imports {imported_roots(p) & HEAVY}"
        code = "\n".join(ln for ln in p.read_text().splitlines() if not ln.strip().startswith(("#",)))
        assert not HEAVY_TOOLS.search(code), f"{p.relative_to(REPO)} mentions a render-machine tool"


def test_heavy_dependencies_appear_only_in_render_machine_code():
    allowed = tuple(RENDER_MACHINE)
    for p in py_files("."):
        rel = p.relative_to(REPO).as_posix()
        if rel.startswith(allowed) or rel.startswith(("shared/tests/",)):
            continue
        assert not (imported_roots(p) & HEAVY), f"{rel} imports {imported_roots(p) & HEAVY} but is not render-machine code"


def test_pipeline_runs_the_heavy_tools_only_as_child_processes():
    for p in py_files("pipeline/src"):
        assert not (imported_roots(p) & (HEAVY | {"vbeat_sprite", "vbeat_audio"})), p


def test_package_layering_is_respected():
    for pkg, allowed in ALLOWED.items():
        for p in py_files(PKG_DIR[pkg]):
            used = {m for m in imported_roots(p) if m.startswith("vbeat_") and m != pkg}
            assert used <= allowed, f"{p.relative_to(REPO)} imports {used - allowed}; {pkg} may import {sorted(allowed)}"
    for p in py_files("devserver"):
        assert {m for m in imported_roots(p) if m.startswith("vbeat_") and m != "vbeat_mock_server"} <= {"vbeat_shared"}, p


def test_nothing_ships_a_second_copy_of_shared_code():
    names = {"timeline.py", "ingest.py", "envelope.py", "markers.py"}
    for p in py_files("."):
        if p.name in names and "shared/src/vbeat_shared" not in p.as_posix():
            raise AssertionError(f"{p.relative_to(REPO)} duplicates a shared module name")
    copies = [p for p in (REPO).rglob("core.js") if "node_modules" not in p.parts]
    real = [p.relative_to(REPO).as_posix() for p in copies if "tests/fixtures" not in p.as_posix() and "/_dev/" not in p.as_posix()]
    assert real == ["motion-assets/assets/core/core.js"], real
    assert [p.relative_to(REPO).as_posix() for p in REPO.rglob("palette.js") if "tests/fixtures" not in p.as_posix()] == ["motion-assets/assets/core/palette.js"]
    assert [p.relative_to(REPO).as_posix() for p in REPO.rglob("fonts.css")] == ["motion-assets/assets/core/fonts.css"]
    assert [p.relative_to(REPO).as_posix() for p in REPO.rglob("runtime.js") if "mock-runtime" not in p.parts] == ["engine/runtime/runtime.js"]


WEB = REPO / "frontend" / "web"
EXTERNAL = re.compile(r"""(?:https?:)?//(?!www\.w3\.org/)[a-z0-9.-]+\.[a-z]{2,}""", re.I)


def test_web_ui_has_no_build_step():
    forbidden = ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "tsconfig.json", "vite.config.js", "webpack.config.js",
                 "rollup.config.js", "babel.config.js", ".babelrc", "postcss.config.js", "tailwind.config.js"]
    for f in forbidden:
        assert not list((REPO / "frontend").rglob(f)), f
    assert not list((REPO / "frontend").rglob("node_modules"))
    exts = {p.suffix for p in WEB.rglob("*") if p.is_file()}
    assert exts <= {".html", ".js", ".css", ".svg", ".png", ".ico", ".json", ".txt", ".woff2"}, exts
    for html in WEB.rglob("*.html"):
        for m in re.finditer(r"<script\b([^>]*)>", html.read_text()):
            attrs = m.group(1)
            assert 'type="module"' in attrs and re.search(r'src="/?[^"]+"', attrs) and "http" not in attrs, (html.name, attrs)


def test_web_ui_loads_no_external_resource():
    for p in WEB.rglob("*"):
        if not p.is_file() or p.suffix not in {".html", ".js", ".css", ".svg", ".json"}:
            continue
        for n, line in enumerate(p.read_text().splitlines(), 1):
            code = re.sub(r"(^|\s)//.*$", "", line)          # drop '// comment' tails; a URL has no space before its '//'
            assert not EXTERNAL.search(code), f"{p.relative_to(REPO)}:{n}: {line.strip()[:100]}"


def test_backend_declares_its_dependencies_and_imports_no_heavy_libraries():
    """Workers reach Playwright/numpy/ffmpeg only through vbeat_agent's subprocess tools; the only third-party import is psycopg."""
    meta = tomllib.loads((REPO / "backend" / "pyproject.toml").read_text())
    deps = {re.split(r"[\[<>=! ]", d, 1)[0] for d in meta["project"]["dependencies"]}
    assert deps == {"vbeat-shared", "vbeat-agent", "psycopg"}, deps
    stdlib = set(sys.stdlib_module_names)
    allowed = stdlib | {"vbeat_backend", "vbeat_shared", "vbeat_agent", "psycopg", "psycopg_pool"}
    for p in py_files("backend/src"):
        roots = imported_roots(p)
        assert not roots & HEAVY, f"{p.relative_to(REPO)} imports heavy libraries {roots & HEAVY}"
        assert roots <= allowed, f"{p.relative_to(REPO)} imports undeclared packages {roots - allowed}"
