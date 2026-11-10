"""The worker's tiny status app (standard library only), on PORT (default 8080), in a thread next to the asyncio loop.

    GET  /healthz    open. {"ok": true, "worker": id, "running": n, "slots": n, "claiming": bool, "version": ...}  (no secrets)
    POST /wake       X-Tick-Secret required. Looks for work now. Returns the running count.
    GET  /preflight  X-Tick-Secret required. Runs the runner's preflight and returns its report.
"""
from __future__ import annotations

import hmac
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

log = logging.getLogger("vbeat_backend.http")


def make_handler(info: Callable[[], dict], wake: Callable[[], None], preflight: Callable[[], dict], secret: str) -> type[BaseHTTPRequestHandler]:
    def authorized(h: BaseHTTPRequestHandler) -> bool:
        given = h.headers.get("X-Tick-Secret", "")
        return bool(secret) and hmac.compare_digest(given.encode(), secret.encode())

    class Handler(BaseHTTPRequestHandler):
        server_version = "vbeat-worker"

        def log_message(self, fmt: str, *args: Any) -> None:     # quiet: never log headers or query strings
            log.debug("%s", fmt % args)

        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?")[0]
            if path == "/healthz":
                return self._send(200, info())
            if path == "/preflight":
                if not authorized(self):
                    return self._send(401, {"ok": False, "error": "X-Tick-Secret missing or wrong"})
                return self._send(200, preflight())
            self._send(404, {"ok": False, "error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?")[0]
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(min(length, 65536))
            if path == "/wake":
                if not authorized(self):
                    return self._send(401, {"ok": False, "error": "X-Tick-Secret missing or wrong"})
                wake()
                return self._send(200, {"ok": True, **info()})
            self._send(404, {"ok": False, "error": "not found"})
    return Handler


def start_http(port: int, info: Callable[[], dict], wake: Callable[[], None], preflight: Callable[[], dict], secret: str, host: str = "0.0.0.0") -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(info, wake, preflight, secret))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="worker-http", daemon=True).start()
    return server
