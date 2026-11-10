"""Supabase Storage over its REST API (standard library only), with retries. Buckets are private; the service-role key is the credential.

    Storage(url, key).upload("previews", "<project>/<beat>/scene_001.strip.jpg", data_or_path, "image/jpeg")
    Storage(url, key).download("uploads", "<project>/media.png", dest_path)

Paths are object names inside a bucket (no leading slash). Uploads overwrite (x-upsert), which is what makes every upload idempotent.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from vbeat_agent.redact import redact

log = logging.getLogger("vbeat_backend.storage")


class StorageError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class Storage:
    def __init__(self, base_url: str, service_key: str, *, tries: int = 4, timeout: float = 120.0, sleep=time.sleep):
        self.base = base_url.rstrip("/") + "/storage/v1"
        self.key, self.tries, self.timeout, self._sleep = service_key, tries, timeout, sleep

    def _url(self, *parts: str) -> str:
        return self.base + "/" + "/".join(urllib.parse.quote(p, safe="/") for p in parts)

    def _request(self, method: str, url: str, body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, bytes]:
        h = {"Authorization": f"Bearer {self.key}", "apikey": self.key, **(headers or {})}
        last: Exception | None = None
        for attempt in range(self.tries):
            try:
                req = urllib.request.Request(url, data=body, method=method, headers=h)
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as exc:
                detail = redact(exc.read().decode("utf-8", "replace")[:300])
                if exc.code in (408, 425, 429) or exc.code >= 500:
                    last = StorageError(f"storage {method} {url.split('/storage/v1/')[-1]} -> HTTP {exc.code}: {detail}", exc.code)
                else:
                    raise StorageError(f"storage {method} {url.split('/storage/v1/')[-1]} -> HTTP {exc.code}: {detail}", exc.code) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
                last = StorageError(f"storage {method} failed: {redact(str(exc))}")
            if attempt < self.tries - 1:
                self._sleep(0.5 * (3 ** attempt))
        assert last is not None
        raise last

    def upload(self, bucket: str, path: str, data: "bytes | str | Path", content_type: str | None = None) -> int:
        body = Path(data).read_bytes() if isinstance(data, (str, Path)) else data
        ct = content_type or (mimetypes.guess_type(path)[0] if path else None) or "application/octet-stream"
        self._request("POST", self._url("object", bucket, path), body, {"Content-Type": ct, "x-upsert": "true", "Cache-Control": "max-age=3600"})
        return len(body)

    def download(self, bucket: str, path: str, dest: "str | Path") -> int:
        _, body = self._request("GET", self._url("object", bucket, path))
        d = Path(dest)
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_bytes(body)
        return len(body)

    def read(self, bucket: str, path: str) -> bytes:
        return self._request("GET", self._url("object", bucket, path))[1]

    def list(self, bucket: str, prefix: str = "", limit: int = 1000) -> list[dict[str, Any]]:
        body = json.dumps({"prefix": prefix, "limit": limit, "offset": 0}).encode()
        return json.loads(self._request("POST", self._url("object", "list", bucket), body, {"Content-Type": "application/json"})[1] or b"[]")

    def delete(self, bucket: str, paths: list[str]) -> None:
        if paths:
            self._request("DELETE", self._url("object", bucket), json.dumps({"prefixes": paths}).encode(), {"Content-Type": "application/json"})

    def delete_prefix(self, bucket: str, prefix: str) -> int:
        """Delete every object under `prefix` (folders are walked one level at a time). Returns how many objects were removed."""
        n = 0
        for item in self.list(bucket, prefix):
            name = f"{prefix.rstrip('/')}/{item['name']}"
            if item.get("id") is None:                 # a folder
                n += self.delete_prefix(bucket, name)
            else:
                self.delete(bucket, [name])
                n += 1
        return n
