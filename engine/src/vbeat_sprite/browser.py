"""Playwright Chromium session: local server + headless browser, guaranteed shutdown, event capture."""
from __future__ import annotations

import os
import signal
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit

from .server import LocalServer
from .spec import BeatSpec

MAX_SCENE_BYTES = 200 * 1024
DEFAULT_CALL_TIMEOUT = 60.0

# Verified accepted: each flag is visible in the browser process command line (see DECISIONS.md).
CHROMIUM_FLAGS = [
    "--font-render-hinting=none",
    "--disable-lcd-text",
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--disable-gpu",
]


def default_runtime_dir() -> Path:
    env = os.environ.get("VBEAT_RUNTIME_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "runtime"


class ContentError(Exception):
    """The scene (not the tool) is at fault. `type` is the JSON error type."""
    type = "ContentError"

    def __init__(self, message: str, *, t: float | None = None, stack: str = ""):
        super().__init__(message)
        self.message, self.t, self.stack = message, t, stack


class SceneFailure(ContentError):
    type = "SceneError"


class LoadFailure(ContentError):
    type = "LoadError"


class MarkerFailure(ContentError):
    type = "MarkerError"


class SceneTooLarge(ContentError):
    type = "SceneTooLarge"


class RenderTimeout(ContentError):
    type = "RenderTimeout"


class BrowserCrash(RuntimeError):
    """Chromium died or the page was lost for a reason that is not a scene hang."""


_ERROR_TYPES = {"SceneError": SceneFailure, "LoadError": LoadFailure, "MarkerError": MarkerFailure}
_CALL_JS = "([fn, args]) => window.vb[fn](...args)"


def _pids_with(marker: bytes) -> list[int]:
    pids = []
    for name in os.listdir("/proc"):
        if name.isdigit():
            try:
                with open(f"/proc/{name}/cmdline", "rb") as fh:
                    if marker in fh.read():
                        pids.append(int(name))
            except OSError:
                continue
    return pids


class ScenePage:
    """One browser page running the harness. Calls never throw scene errors as raw Playwright errors."""

    def __init__(self, session: "BrowserSession", page: Any):
        self.session, self.page = session, page

    def call(self, fn: str, *args: Any, timeout: float | None = None) -> dict[str, Any]:
        """Call window.vb[fn](*args); returns the raw {ok, ...} dict. Raises RenderTimeout on a hang."""
        from playwright.sync_api import Error as PlaywrightError
        with self.session.watchdog(timeout):
            try:
                return self.page.evaluate(_CALL_JS, [fn, list(args)])
            except PlaywrightError as exc:
                if self.session.timed_out:
                    last = self.session.last_progress
                    where = f" (last sampled t={last}s)" if last is not None else ""
                    raise RenderTimeout(
                        f"scene did not return within {timeout or self.session.call_timeout:g}s{where}: "
                        "probable infinite loop"
                    ) from None
                raise BrowserCrash(str(exc)) from None

    def ok(self, fn: str, *args: Any, timeout: float | None = None) -> dict[str, Any]:
        """Like call(), but raises a ContentError subclass when the page reports a failure."""
        res = self.call(fn, *args, timeout=timeout)
        if res.get("ok"):
            return res
        err = res.get("error") or {}
        cls = _ERROR_TYPES.get(err.get("type"))
        if cls is None:
            raise RuntimeError(f"harness error in {fn}: {err.get('type')}: {err.get('message')}\n{err.get('stack', '')}")
        raise cls(err.get("message", ""), t=err.get("t"), stack=err.get("stack", ""))

    def init(self) -> dict[str, Any]:
        return self.ok("init", self.session.spec.page_spec())


class BrowserSession:
    """Context manager: LocalServer + Chromium. Both are shut down even when the body raises."""

    def __init__(self, spec: BeatSpec, *, call_timeout: float = DEFAULT_CALL_TIMEOUT, runtime_dir: Path | None = None):
        self.spec = spec
        self.call_timeout = call_timeout
        self.runtime_dir = Path(runtime_dir) if runtime_dir else default_runtime_dir()
        self.events: list[dict[str, Any]] = []
        self.timed_out = False
        self.last_progress: float | None = None
        self._pw = self._browser = self._context = self._server = None
        self._pages: list[Any] = []
        self._aborted: set[str] = set()
        self._marker = f"--vbeat-session={uuid.uuid4().hex}"

    # ---- lifecycle
    def __enter__(self) -> "BrowserSession":
        try:
            scene = Path(self.spec.scene)
            if not scene.is_file():
                raise LoadFailure(f"scene file not found: {scene}")
            size = scene.stat().st_size
            if size > MAX_SCENE_BYTES:
                raise SceneTooLarge(f"scene is {size} bytes; the limit is {MAX_SCENE_BYTES}")
            from playwright.sync_api import sync_playwright
            self._server = LocalServer(self.runtime_dir, Path(self.spec.assets_dir), scene, self.spec.media).start()
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=True, args=CHROMIUM_FLAGS + [self._marker])
            self._context = self._browser.new_context(
                viewport={"width": 1280, "height": 720}, device_scale_factor=1, service_workers="block",
            )
            self._context.route("**/*", self._route)
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        for step in (
            lambda: self._context and self._context.close(),
            lambda: self._browser and self._browser.close(),
            lambda: self._pw and self._pw.stop(),
            lambda: self._server and self._server.stop(),
        ):
            try:
                step()
            except Exception:
                pass
        for pid in _pids_with(self._marker.encode()):      # belt and braces: nothing may outlive the session
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        self._context = self._browser = self._pw = self._server = None

    # ---- events
    @property
    def origin(self) -> str:
        assert self._server is not None
        return self._server.origin

    def _record(self, kind: str, message: str, url: str | None = None) -> None:
        ev = {"kind": kind, "message": message, "url": url}
        if ev not in self.events:
            self.events.append(ev)

    def _route(self, route: Any) -> None:
        url = route.request.url
        if urlsplit(url).netloc == urlsplit(self.origin).netloc:
            route.continue_()
            return
        self._aborted.add(url)
        self._record("blocked_request", f"request to non-local origin blocked: {url}", url)
        route.abort("blockedbyclient")

    def _attach(self, page: Any) -> None:
        def on_console(msg: Any) -> None:
            text = msg.text
            if msg.type == "debug" and text.startswith("vb:t="):
                try:
                    self.last_progress = float(text[5:])
                except ValueError:
                    pass
                return
            if msg.type == "error":
                loc = (getattr(msg, "location", None) or {}).get("url", "") or ""
                if "/media/" in loc and "Failed to load resource" in text:
                    return          # declared-but-missing media is reported by check C9
                self._record("console_error", text, loc or None)

        page.on("console", on_console)
        page.on("pageerror", lambda e: self._record("pageerror", str(e)))
        page.on("requestfailed", lambda r: None if r.url in self._aborted else
                self._record("request_failed", f"request failed: {r.url} ({r.failure})", r.url))

    def new_page(self, *, load_harness: bool = True) -> ScenePage:
        assert self._context is not None, "BrowserSession is not open"
        page = self._context.new_page()
        self._pages.append(page)
        self._attach(page)
        if load_harness:
            self.timed_out = False
            page.goto(self.origin + "/runtime/harness.html", wait_until="load")
            page.wait_for_function("window.vb !== undefined", timeout=15000)
        return ScenePage(self, page)

    # ---- watchdog
    @contextmanager
    def watchdog(self, timeout: float | None = None) -> Iterator[None]:
        """Kill Chromium if one call runs too long (a scene with an infinite loop would block forever)."""
        limit = timeout or self.call_timeout
        marker = self._marker.encode()

        def fire() -> None:
            self.timed_out = True
            for pid in _pids_with(marker):
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass

        timer = threading.Timer(limit, fire)
        timer.daemon = True
        timer.start()
        try:
            yield
        finally:
            timer.cancel()
