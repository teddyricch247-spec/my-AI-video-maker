"""Asset-library rules that must exist exactly once: which files are asset modules, the manifest, the index, id namespaces.

Used by: the render engine's local server (module list for the page), the asset tools in motion-assets/tools,
`scripts/check_assets.py`, the dev server, and later the backend. Standard library only: no browser is needed.
The browser-side truth (evaluated `meta`, duplicate ids at import time) is produced by `motion-assets/tools/build_index.py`
and the runtime; this module checks the *files* that build produces. See docs/CONTRACTS.md section 8.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .markers import MARKER_KINDS

# id namespaces. A namespace is reserved to one asset zip; a new zip that needs another one adds it here (one line).
NAMESPACES = {
    "tech": "motion-assets technical half (scenes and parts)",
    "obj": "motion-assets technical half (icons)",
    "fx": "motion-assets technical half (effects)",
    "people": "story assets zip (characters)",
    "env": "story assets zip (environments)",
    "story": "story assets zip (story scenes)",
}
ID_RE = re.compile(r"^(?P<ns>[a-z][a-z0-9]*)/(?P<name>[a-z0-9][a-z0-9_-]*)$")
SKIP_TOP = ("core", "_dev")  # never asset modules
REQUIRED_CORE = ("core/core.js", "core/palette.js")  # the frozen core API; fonts.css is optional
INDEX_REQUIRED = ("id", "kind", "description", "params", "markers", "module")
_EXPORT_RE = re.compile(r"^export\s+const\s+assets\b", re.M)
_KEY_RE = re.compile(r"""['"]((?:%s)/[a-z0-9][a-z0-9_-]*)['"]\s*:""" % "|".join(NAMESPACES))


@dataclass(frozen=True)
class Problem:
    level: str   # "error" | "warn"
    code: str    # stable short code, e.g. STALE_MANIFEST
    message: str

    def __str__(self) -> str:
        return f"{self.level.upper()} {self.code}: {self.message}"


def safe_join(root: Path, rel: str) -> Path | None:
    """Resolve rel under root. None if it escapes root (.., symlinks, NUL, absolute) or is not a file."""
    if not rel or "\x00" in rel or "\\" in rel or rel.startswith("/"):
        return None
    root_r = root.resolve()
    try:
        target = (root_r / rel).resolve()
    except (OSError, ValueError):
        return None
    if target != root_r and root_r not in target.parents:
        return None
    return target if target.is_file() else None


def _skipped(rel: Path) -> bool:
    return rel.parts[0] in SKIP_TOP or any(part.startswith(".") for part in rel.parts)


def discover_modules(assets_dir: Path) -> list[str]:
    """Every assets/**/*.js (outside core/ and _dev/) that declares `export const assets`, sorted, relative to assets_dir.

    This is the rule `motion-assets/tools` uses to write manifest.json.
    """
    root = Path(assets_dir).resolve()
    out = []
    for p in sorted(root.rglob("*.js")):
        rel = p.relative_to(root)
        if _skipped(rel):
            continue
        if _EXPORT_RE.search(_strip_comments(p.read_text(encoding="utf-8"))):
            out.append(rel.as_posix())
    return out


def read_manifest(assets_dir: Path) -> list[str] | None:
    m = Path(assets_dir) / "manifest.json"
    if not m.is_file():
        return None
    mods = json.loads(m.read_text(encoding="utf-8")).get("modules", [])
    return [x for x in mods if isinstance(x, str)] if isinstance(mods, list) else []


def write_manifest(assets_dir: Path, modules: Iterable[str] | None = None) -> list[str]:
    """Write manifest.json ({"modules": [...]}, indent 1, the format the tools always wrote) and return the module list."""
    mods = sorted(modules) if modules is not None else discover_modules(assets_dir)
    with open(Path(assets_dir) / "manifest.json", "w", encoding="utf-8") as f:
        json.dump({"modules": mods}, f, indent=1)
    return mods


def list_asset_modules(assets_dir: Path) -> dict:
    """What the render page is told to import (`/_index.json`): manifest.json 'modules' if present, else every
    assets/**/*.js except core/ and _dev/. Also says whether core/fonts.css exists."""
    root = Path(assets_dir).resolve()
    manifest = root / "manifest.json"
    modules: list[str] = []
    source = "glob"
    if manifest.is_file():
        source = "manifest"
        try:
            listed = json.loads(manifest.read_text(encoding="utf-8")).get("modules", [])
        except (OSError, ValueError, AttributeError):
            listed = []
        for rel in listed if isinstance(listed, list) else []:
            if isinstance(rel, str) and rel.endswith(".js") and safe_join(root, rel):
                modules.append(rel.replace("\\", "/"))
    else:
        for p in sorted(root.rglob("*.js")):
            rel = p.relative_to(root)
            if _skipped(rel):
                continue
            modules.append(rel.as_posix())
    return {"modules": modules, "fonts_css": (root / "core" / "fonts.css").is_file(), "source": source}


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    return re.sub(r"(?<![:'\"`\\])//[^\n]*", "", src)


def declared_ids(assets_dir: Path, modules: Iterable[str]) -> dict[str, list[str]]:
    """Static scan: id -> modules that declare it as an object key `'ns/name':` (comments ignored)."""
    root = Path(assets_dir).resolve()
    out: dict[str, list[str]] = {}
    for rel in modules:
        p = root / rel
        if not p.is_file():
            continue
        src = _strip_comments(p.read_text(encoding="utf-8"))
        for i in sorted(set(_KEY_RE.findall(src))):
            out.setdefault(i, []).append(rel)
    return out


def check_tree(assets_dir: Path) -> list[Problem]:
    """Everything that can be verified from the files alone. Errors mean the library cannot be trusted as it stands.

    A zip that is dropped in without re-running the index tool shows up here as STALE_MANIFEST / STALE_INDEX.
    """
    root = Path(assets_dir).resolve()
    probs: list[Problem] = []
    err = lambda code, msg: probs.append(Problem("error", code, msg))  # noqa: E731
    for rel in REQUIRED_CORE:
        if not (root / rel).is_file():
            err("MISSING_CORE", f"{rel} is missing (the frozen core API)")
    core_copies = [p.relative_to(root).as_posix() for p in root.rglob("core.js") if p.relative_to(root).as_posix() != "core/core.js"]
    for c in core_copies:
        err("DUPLICATE_CORE", f"{c}: a second copy of core.js; the core exists once, in core/")

    on_disk = discover_modules(root)
    manifest = read_manifest(root)
    if manifest is None:
        err("NO_MANIFEST", "manifest.json is missing; run `make index`")
        manifest = []
    missing = sorted(set(on_disk) - set(manifest))
    extra = sorted(set(manifest) - set(on_disk))
    if missing:
        err("STALE_MANIFEST", f"modules on disk but not in manifest.json (they would be silently ignored): {missing}; run `make index`")
    if extra:
        err("STALE_MANIFEST", f"manifest.json lists modules that are not asset modules on disk: {extra}; run `make index`")
    if len(set(manifest)) != len(manifest):
        err("STALE_MANIFEST", "manifest.json lists a module twice")

    for i, mods in sorted(declared_ids(root, on_disk).items()):
        if len(mods) > 1:
            err("ID_COLLISION", f"asset id '{i}' is declared in {len(mods)} modules: {mods}")

    idx_path = root / "index.json"
    if not idx_path.is_file():
        err("NO_INDEX", "index.json is missing; run `make index`")
        return probs
    try:
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
    except ValueError as e:
        err("BAD_INDEX", f"index.json is not valid JSON: {e}")
        return probs
    assets = idx.get("assets")
    if idx.get("version") != 1 or not isinstance(assets, list):
        err("BAD_INDEX", "index.json must be {version:1, count, modules, assets:[...]}")
        return probs
    if idx.get("count") != len(assets):
        err("BAD_INDEX", f"index.json count {idx.get('count')} != {len(assets)} entries")
    if sorted(idx.get("modules", [])) != sorted(manifest):
        err("STALE_INDEX", "index.json 'modules' differs from manifest.json; run `make index`")
    seen: dict[str, int] = {}
    for n, a in enumerate(assets):
        aid = a.get("id") if isinstance(a, dict) else None
        if not isinstance(aid, str):
            err("BAD_INDEX", f"entry {n} has no string id")
            continue
        seen[aid] = seen.get(aid, 0) + 1
        m = ID_RE.match(aid)
        if not m:
            err("BAD_ID", f"'{aid}' is not <namespace>/<name> in lower-case letters, digits, - and _")
        elif m["ns"] not in NAMESPACES:
            err("UNKNOWN_NAMESPACE", f"'{aid}': namespace '{m['ns']}' is not registered in vbeat_shared.assets.NAMESPACES")
        for k in INDEX_REQUIRED:
            if k not in a:
                err("BAD_INDEX", f"'{aid}' lacks '{k}'")
        if a.get("module") not in manifest:
            err("STALE_INDEX", f"'{aid}' comes from module {a.get('module')!r}, which is not in manifest.json")
        bad = [k for k in a.get("markers", []) if k not in MARKER_KINDS]
        if bad:
            err("BAD_MARKER_KIND", f"'{aid}' declares marker kinds {bad}; allowed: {list(MARKER_KINDS)}")
    for aid, c in sorted(seen.items()):
        if c > 1:
            err("ID_COLLISION", f"asset id '{aid}' appears {c} times in index.json")
    indexed_mods = {a.get("module") for a in assets if isinstance(a, dict)}
    for m in sorted(set(manifest) - indexed_mods):
        err("STALE_INDEX", f"module {m} is in manifest.json but contributes no asset to index.json; run `make index`")
    declared = declared_ids(root, on_disk)
    for aid in sorted(set(declared) - set(seen)):
        err("STALE_INDEX", f"id '{aid}' is declared in {declared[aid]} but absent from index.json; run `make index`")
    return probs
