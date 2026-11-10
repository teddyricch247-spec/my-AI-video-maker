"""A scripted local HTTP server standing in for OpenRouter in tests (stdlib only; binds 127.0.0.1 on a free port)."""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class Reply:
    def __init__(self, status: int = 200, body: Any = None, *, headers: dict[str, str] | None = None, delay: float = 0.0, raw: bytes | None = None):
        self.status, self.body, self.headers, self.delay, self.raw = status, body, headers or {}, delay, raw


def chat_ok(content: str | None = "hi", *, tool_calls: list[dict] | None = None, cost: float | None = 0.002, prompt: int = 100, completion: int = 20,
            finish: str = "stop", model: str = "test/model") -> dict:
    msg: dict[str, Any] = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    usage: dict[str, Any] = {"prompt_tokens": prompt, "completion_tokens": completion}
    if cost is not None:
        usage["cost"] = cost
    return {"id": "gen-123", "model": model, "choices": [{"index": 0, "finish_reason": finish, "message": msg}], "usage": usage}


def tool_call(name: str, args: Any, call_id: str = "call_1") -> dict:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": args if isinstance(args, str) else json.dumps(args)}}


class FakeOpenRouter:
    """`queue(path_suffix, *replies)`: replies are served in order for that path; the last one repeats. Requests are recorded."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._queues: dict[str, list[Reply]] = {}
        outer = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a: Any) -> None:   # silence
                pass

            def _serve(self) -> None:
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                try:
                    body = json.loads(raw) if raw else None
                except ValueError:
                    body = None
                outer.requests.append({"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "json": body})
                rep = outer._next(self.path)
                if rep.delay:
                    time.sleep(rep.delay)
                data = rep.raw if rep.raw is not None else json.dumps(rep.body if rep.body is not None else {}).encode()
                self.send_response(rep.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for k, v in rep.headers.items():
                    self.send_header(k, v)
                self.end_headers()
                try:
                    self.wfile.write(data)
                except OSError:
                    pass

            do_GET = do_POST = _serve

        self._srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self._srv.daemon_threads = True
        self.port = self._srv.server_address[1]
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/api/v1"

    def queue(self, suffix: str, *replies: Reply) -> None:
        self._queues[suffix] = list(replies)

    def _next(self, path: str) -> Reply:
        for suffix, q in self._queues.items():
            if path.endswith(suffix):
                return q.pop(0) if len(q) > 1 else q[0]
        return Reply(404, {"error": {"message": f"no route {path}"}})

    def count(self, suffix: str) -> int:
        return sum(1 for r in self.requests if r["path"].endswith(suffix))

    def start(self) -> "FakeOpenRouter":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._srv.shutdown()
        self._srv.server_close()

    def __enter__(self) -> "FakeOpenRouter":
        return self.start()

    def __exit__(self, *a: Any) -> None:
        self.stop()
