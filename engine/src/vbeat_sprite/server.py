"""Local HTTP server for the render page. Serves only what a beat needs; everything else is 404."""
from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from vbeat_shared.assets import list_asset_modules, safe_join  # noqa: F401  (single source: docs/CONTRACTS.md section 8)
from vbeat_shared.preview import RENDER_CSP

CSP = RENDER_CSP
MIME = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css",
    ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2",
    ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8",
}
_MEDIA_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class _Handler(BaseHTTPRequestHandler):
    server: "LocalServer"
    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # silence
        pass

    def _send(self, status: int, body: bytes = b"", ctype: str = "text/plain; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _file(self, path: Path | None) -> None:
        if path is None:
            return self._send(404, b"not found")
        try:
            data = path.read_bytes()
        except OSError:
            return self._send(404, b"not found")
        self._send(200, data, MIME.get(path.suffix.lower(), "application/octet-stream"))

    def _route(self) -> None:
        s = self.server
        path = unquote(urlsplit(self.path).path)
        if path == "/_index.json":
            return self._send(200, json.dumps(list_asset_modules(s.assets_dir)).encode(), "application/json")
        if path == "/scene.js":
            return self._file(s.scene_path if s.scene_path.is_file() else None)
        if path.startswith("/media/"):
            mid = path[len("/media/"):]
            declared = s.media.get(mid) if _MEDIA_ID.match(mid) else None
            return self._file(declared if declared and declared.is_file() else None)
        if path.startswith("/runtime/"):
            return self._file(safe_join(s.runtime_dir, path[len("/runtime/"):]))
        if path.startswith("/assets/"):
            return self._file(safe_join(s.assets_dir, path[len("/assets/"):]))
        self._send(404, b"not found")

    def do_GET(self) -> None:
        self._route()

    def do_HEAD(self) -> None:
        self._route()

    def _nope(self) -> None:
        self._send(404, b"not found")

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _nope


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, runtime_dir: Path, assets_dir: Path, scene_path: Path, media: dict[str, str] | None = None):
        super().__init__(("127.0.0.1", 0), _Handler)
        self.runtime_dir = Path(runtime_dir).resolve()
        self.assets_dir = Path(assets_dir).resolve()
        self.scene_path = Path(scene_path).resolve()
        self.media = {k: Path(v) for k, v in (media or {}).items()}
        self._thread: threading.Thread | None = None

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def start(self) -> "LocalServer":
        self._thread = threading.Thread(target=self.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        try:
            self.shutdown()
        finally:
            self.server_close()
            if self._thread:
                self._thread.join(timeout=5)

    def __enter__(self) -> "LocalServer":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()
