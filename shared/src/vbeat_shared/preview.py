"""The preview bundle and the HTTP headers the sandboxed preview needs (docs/CONTRACTS.md sections 9 and 10).

The browser plays a beat inside `<iframe sandbox="allow-scripts">` (opaque origin, no cookies). This module is the one
place that says which headers and URLs make that work; the dev server (and later the backend) use it unchanged.
"""
from __future__ import annotations

from typing import Any, Mapping

LOGICAL_W, LOGICAL_H = 1280, 720

# Every URL the frame loads (frame html, runtime, asset modules, fonts, scene, media) must carry these.
PREVIEW_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    "X-Content-Type-Options": "nosniff",
}
# Extra header for /preview-frame.html only (the iframe `sandbox` attribute is the real boundary).
FRAME_CSP = ("sandbox allow-scripts; default-src 'none'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
             "connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'")
# The render machine's local page (engine/src/vbeat_sprite/server.py) is stricter: nothing but itself.
RENDER_CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
              "img-src 'self' data: blob:; connect-src 'self'")
IMMUTABLE = "public, max-age=31536000, immutable"   # only for URLs that change with the version
REVALIDATE = "no-cache"
MIME = {
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
    ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2",
    ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8", ".wav": "audio/wav",
    ".mp4": "video/mp4",
}
# URL space under a prefix (default "/preview/"): the same paths the render machine's local server uses at "/".
RUNTIME_REL = "runtime/runtime.js"   # the only runtime file the browser preview needs
BUNDLE_KEYS = ("fps", "frames", "dur", "width", "height", "runtime_url", "assets_base_url", "scene_url", "spec", "media", "wav_url")
SPEC_PUBLIC_KEYS = ("project", "beat", "words", "params", "media")  # what leaves the server: no file-system paths


def engine_urls(prefix: str = "/preview/") -> dict[str, str]:
    if not (prefix.startswith("/") and prefix.endswith("/")):
        raise ValueError("prefix must start and end with '/'")
    return {"runtime_url": prefix + RUNTIME_REL, "assets_base_url": prefix}


def public_spec(spec: Mapping[str, Any], media_urls: Mapping[str, str]) -> dict:
    """The beat spec as the browser runtime reads it: server paths removed, media ids mapped to URLs."""
    out = {k: spec[k] for k in SPEC_PUBLIC_KEYS if k in spec and k != "media"}
    out["media"] = dict(media_urls)
    out.setdefault("params", {})
    return out


def build_preview_bundle(spec: Mapping[str, Any], *, scene_url: str, media_urls: Mapping[str, str] | None = None,
                         wav_url: str | None = None, width: int = 960, prefix: str = "/preview/") -> dict:
    """PreviewBundle (docs/API_CONTRACT.md) for an engine beat spec. `width` is the pixel width of the preview canvas
    (16:9, at most 1280); the runtime draws at scale width/1280."""
    if not 16 <= width <= LOGICAL_W or width % 16:
        raise ValueError(f"preview width must be a multiple of 16 in 16..{LOGICAL_W}, got {width}")
    fps = int(spec["project"]["fps"])
    frames = int(spec["beat"]["f1"]) - int(spec["beat"]["f0"])
    urls = engine_urls(prefix)
    return {"fps": fps, "frames": frames, "dur": frames / fps, "width": width, "height": width * 9 // 16,
            "runtime_url": urls["runtime_url"], "assets_base_url": urls["assets_base_url"], "scene_url": scene_url,
            "spec": public_spec(spec, media_urls or {}), "media": dict(media_urls or {}), "wav_url": wav_url}


def validate_bundle(b: Any) -> list[str]:
    """Problems with a PreviewBundle, empty when it is one the real runtime can play."""
    if not isinstance(b, dict):
        return ["bundle is not an object"]
    out = [f"missing key '{k}'" for k in BUNDLE_KEYS if k not in b]
    if out:
        return out
    for k in ("runtime_url", "assets_base_url", "scene_url"):
        if not (isinstance(b[k], str) and b[k].startswith("/")):
            out.append(f"'{k}' must be a root-relative URL")
    if isinstance(b["assets_base_url"], str) and not b["assets_base_url"].endswith("/"):
        out.append("'assets_base_url' must end with '/' (the runtime appends _index.json and assets/)")
    if isinstance(b["runtime_url"], str) and isinstance(b["assets_base_url"], str) and b["runtime_url"] != b["assets_base_url"] + RUNTIME_REL:
        out.append(f"'runtime_url' must be assets_base_url + '{RUNTIME_REL}'")
    spec = b["spec"]
    if not (isinstance(spec, dict) and {"project", "beat", "words"} <= set(spec)):
        return out + ["'spec' must be an engine beat spec (project, beat, words)"]
    leaked = [k for k in ("scene", "assets_dir") if k in spec]
    if leaked:
        out.append(f"'spec' leaks server paths: {leaked}")
    frames = spec["beat"]["f1"] - spec["beat"]["f0"]
    if b["frames"] != frames or b["fps"] != spec["project"]["fps"] or abs(b["dur"] - frames / b["fps"]) > 1e-9:
        out.append("fps/frames/dur disagree with the spec")
    if not (b["width"] * 9 == b["height"] * 16 and 16 <= b["width"] <= LOGICAL_W):
        out.append("width/height must be 16:9 with width <= 1280")
    if dict(spec.get("media", {})) != dict(b["media"]):
        out.append("spec.media and media must be the same id -> URL map")
    for i, u in b["media"].items():
        if not (isinstance(u, str) and u.startswith("/")):
            out.append(f"media '{i}' must be a root-relative URL")
    return out
