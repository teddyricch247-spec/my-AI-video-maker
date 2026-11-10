"""Requirement 3: the web UI's preview player renders a real beat through the real engine, in the browser, inside its sandboxed iframe.

Chain under test: frontend beat page -> GET /api/beats/{id}/preview (devserver, PreviewBundle from vbeat_shared.preview) ->
/preview-frame.html (sandbox="allow-scripts") -> engine/runtime/runtime.js -> motion-assets library -> the beat's scene.js.
The mock runtime is never loaded. The pixels the player shows are compared with what the engine's own renderer produces."""
import io
import json
import time
from pathlib import Path

import pytest

import helpers
from helpers import ASSETS, REPO, TMP, cli, example_beat, spec_only_beat, start_devserver

from vbeat_shared import preview as pv

pytestmark = pytest.mark.render

FRAMES_TO_COMPARE = (12, 100)     # beat-local frames: early (kicker fades in) and after the number landed


def _browser():
    from playwright.sync_api import sync_playwright
    from vbeat_sprite.browser import CHROMIUM_FLAGS
    p = sync_playwright().start()
    return p, p.chromium.launch(args=CHROMIUM_FLAGS)


def _open_beat(browser, base, bid):
    ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
    assert ctx.request.post(base + "/api/login", data={"password": "demo"}).ok
    page = ctx.new_page()
    log = {"console": [], "pageerrors": [], "failed": [], "requests": []}
    page.on("console", lambda m: log["console"].append((m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: log["pageerrors"].append(str(e)))
    page.on("requestfailed", lambda r: log["failed"].append(r.url))
    page.on("request", lambda r: log["requests"].append(r.url))
    page.goto(f"{base}/#/b/{bid}")
    return ctx, page, log


def _frame(page):
    return next(f for f in page.frames if f.url.endswith("/preview-frame.html"))


def _seek(page, n):
    page.fill("#pv-slider", str(n))
    page.dispatch_event("#pv-slider", "input")
    page.wait_for_function("n => document.querySelector('#pv-readout').dataset.frame === String(n)", arg=n)


def _canvas_png(page):
    """Pixels of the canvas inside the sandboxed frame, once the frame has drawn the requested frame (stable across two reads)."""
    from PIL import Image
    import base64
    fr = _frame(page)
    prev = None
    for _ in range(40):
        url = fr.evaluate("document.getElementById('c').toDataURL('image/png')")
        if url == prev:
            return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")
        prev = url
        time.sleep(0.1)
    raise AssertionError("canvas never settled")


def _diff(a, b):
    import numpy as np
    x, y = np.asarray(a, dtype=int), np.asarray(b, dtype=int)
    assert x.shape == y.shape, (x.shape, y.shape)
    d = np.abs(x - y)
    return d.mean(), (d.max(axis=2) > 24).mean()


def test_the_player_shows_what_the_engine_renders():
    beat = example_beat()
    srv, base, real = start_devserver([beat])
    pw, browser = _browser()
    try:
        bid = next(iter(real))
        ctx, page, log = _open_beat(browser, base, bid)
        page.wait_for_selector('.pv-stage[data-state="ready"]', timeout=60000)

        # sandbox: attribute, opaque origin, no storage, no parent access
        assert page.get_attribute("iframe.pv-frame", "sandbox") == "allow-scripts"
        fr = _frame(page)
        assert fr.evaluate("location.origin === 'null' || window.origin === 'null'")
        assert fr.evaluate("(() => { try { localStorage.length; return 'open'; } catch (e) { return 'blocked'; } })()") == "blocked"
        assert fr.evaluate("(() => { try { return parent.document.title; } catch (e) { return 'blocked'; } })()") == "blocked"
        assert fr.evaluate("[document.getElementById('c').width, document.getElementById('c').height]") == [960, 540]

        # the player knows the real beat: frames from the engine, markers from the real library
        spec = json.loads((beat / "spec.json").read_text())
        total = spec["beat"]["f1"] - spec["beat"]["f0"]
        assert int(page.get_attribute("#pv-slider", "max")) + 1 == total
        assert page.locator('.pv-tick[data-id="done"][data-kind="thud"]').count() == 1
        assert page.locator(".pv-tick").count() >= 5

        # the engine's own render of the same frames, at the same size
        shots = {}
        for n in FRAMES_TO_COMPARE:
            _seek(page, n)
            shots[n] = _canvas_png(page)
        rc, env = cli("vbeat_sprite", "frames", "--spec", beat / "spec.json", "--times", ",".join(repr(n / 30) for n in FRAMES_TO_COMPARE),
                      "--size", "960x540", "--format", "png", "--out", TMP / "engine_frames")
        assert rc == 0 and env["ok"], env
        from PIL import Image
        files = sorted(Path(p) for k, p in env["artifacts"].items() if str(p).endswith(".png"))
        assert len(files) == len(FRAMES_TO_COMPARE), env["artifacts"]
        for n, f in zip(FRAMES_TO_COMPARE, files):
            mean, frac = _diff(shots[n], Image.open(f).convert("RGB"))
            assert mean < 0.5 and frac < 0.001, f"frame {n}: preview differs from the engine render (mean {mean:.2f}, {frac:.2%} of pixels)"
        mean, _ = _diff(shots[FRAMES_TO_COMPARE[0]], shots[FRAMES_TO_COMPARE[1]])
        assert mean > 3, "the two frames look the same: the scene is not animating"

        # this really was the real engine: its files were requested, the mock runtime's were not
        reqs = log["requests"]
        assert any(u.endswith("/preview/engine/runtime/runtime.js") for u in reqs)
        assert any(u.endswith(f"/preview/engine/scene/{bid}/1.js") for u in reqs)
        assert any(u.endswith("/preview/engine/assets/technical/scenes-a.js") for u in reqs)
        assert any(u.endswith("/preview/engine/assets/core/fonts.css") for u in reqs)
        assert not any(u.endswith("/runtime/runtime.js") and "/preview/engine/" not in u for u in reqs)
        assert not any("/preview/scene/" in u for u in reqs)
        assert all(u.startswith(base) or u.startswith(("data:", "blob:")) for u in reqs), [u for u in reqs if not u.startswith(base)]
        assert log["failed"] == [] and log["pageerrors"] == [] and log["console"] == [], log
        ctx.close()
    finally:
        browser.close()
        pw.stop()
        srv.shutdown()


def test_sound_effects_are_served_with_range_requests_and_the_player_uses_the_audio_clock():
    beat = example_beat()
    srv, base, real = start_devserver([beat])
    pw, browser = _browser()
    try:
        bid = next(iter(real))
        h = helpers.Http(base)
        h.login()
        bundle = h.json(f"/api/beats/{bid}/preview")
        assert pv.validate_bundle(bundle) == [] and bundle["wav_url"]
        st, hd, body = h.req(bundle["wav_url"], headers={"Range": "bytes=0-99"})
        assert st == 206 and hd["Content-Range"].startswith("bytes 0-99/") and hd["Accept-Ranges"] == "bytes" and len(body) == 100
        assert hd["Access-Control-Allow-Origin"] == "*"
        assert (beat / "sfx" / "sfx.wav").stat().st_size == int(hd["Content-Range"].split("/")[1])
        ctx, page, log = _open_beat(browser, base, bid)
        page.wait_for_selector('.pv-stage[data-state="ready"]', timeout=60000)
        page.click("#pv-play")
        page.wait_for_selector('.pv-stage[data-clock="audio"]', timeout=10000)
        page.click("#pv-play")
        ctx.close()
    finally:
        browser.close()
        pw.stop()
        srv.shutdown()


def test_a_scene_error_in_the_real_engine_is_shown_by_the_player_and_does_not_kill_it():
    import shutil
    src = spec_only_beat()
    beat = TMP / "throwing_beat"
    shutil.copytree(src, beat)
    (beat / "scene.js").write_text(
        "export const meta = { title: 'throws' };\n"
        "export function draw(rt, t) { rt.lib.draw('tech/big-stat', t, {}); if (t >= 1.0) throw new Error('boom at ' + t.toFixed(2)); }\n"
        "export function markers(rt) { return []; }\n")
    srv, base, real = start_devserver([beat])
    pw, browser = _browser()
    try:
        ctx, page, log = _open_beat(browser, base, next(iter(real)))
        page.wait_for_selector('.pv-stage[data-state="ready"]', timeout=60000)
        _seek(page, 60)
        page.wait_for_selector("#pv-error:not([hidden])", timeout=10000)
        text = page.inner_text("#pv-error")
        assert "boom at" in text and "Scene error at" in text, text
        _seek(page, 5)
        page.wait_for_selector("#pv-error", state="hidden", timeout=10000)
        assert page.get_attribute(".pv-stage", "data-state") == "ready"
        ctx.close()
    finally:
        browser.close()
        pw.stop()
        srv.shutdown()
