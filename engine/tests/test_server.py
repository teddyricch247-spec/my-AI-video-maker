import http.client

import pytest
from helpers import ASSETS, ROOT, SCENES, good_scene, png_bytes, write_spec
from vbeat_sprite.browser import BrowserSession, SceneTooLarge
from vbeat_sprite.server import CSP, LocalServer, list_asset_modules
from vbeat_sprite.spec import load_spec


def _get(srv, target, method="GET"):
    host, port = srv.server_address
    conn = http.client.HTTPConnection(host, port, timeout=10)
    conn.request(method, target)             # http.client sends the target verbatim, no '..' normalisation
    r = conn.getresponse()
    body = r.read()
    headers = {k.lower(): v for k, v in r.getheaders()}
    conn.close()
    return r.status, headers, body


def _server(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP SECRET")
    media = tmp_path / "pic.png"
    media.write_bytes(png_bytes(4, 4, (1, 2, 3)))
    other = tmp_path / "undeclared.png"
    other.write_bytes(png_bytes(4, 4, (1, 2, 3)))
    return LocalServer(ROOT / "runtime", ASSETS, good_scene(), {"img1": str(media)}), secret


def test_serves_only_what_a_beat_needs(tmp_path):
    srv, _ = _server(tmp_path)
    with srv:
        assert _get(srv, "/runtime/harness.html")[0] == 200
        assert _get(srv, "/runtime/runtime.js")[0] == 200
        assert _get(srv, "/assets/core/core.js")[0] == 200
        assert _get(srv, "/scene.js")[0] == 200
        assert _get(srv, "/media/img1")[0] == 200
        assert _get(srv, "/_index.json")[0] == 200
        for bad in ["/", "/etc/passwd", "/runtime", "/runtime/", "/assets/", "/assets/nope.js", "/media/nope",
                    "/media/", "/media/undeclared", "/favicon.ico", "/scene.js/x", "/assets/stub"]:
            assert _get(srv, bad)[0] == 404, bad
        assert _get(srv, "/scene.js", "POST")[0] == 404


@pytest.mark.parametrize("target", [
    "/assets/../secret.txt", "/assets/%2e%2e/secret.txt", "/assets/..%2fsecret.txt", "/assets/%2e%2e%2fsecret.txt",
    "/runtime/../../../../etc/passwd", "/runtime/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
    "/assets//etc/passwd", "/assets/core/../../../../../../etc/passwd", "/assets/..\\secret.txt",
    "/assets/%00/etc/passwd", "/media/../secret.txt", "/media/%2e%2e%2fsecret.txt",
])
def test_path_traversal_is_rejected(target, tmp_path):
    srv, _ = _server(tmp_path)
    with srv:
        status, _, body = _get(srv, target)
        assert status == 404
        assert b"TOP SECRET" not in body and b"root:" not in body


def test_symlink_escape_is_rejected(tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text("TOP SECRET")
    assets = tmp_path / "assets"
    (assets / "core").mkdir(parents=True)
    (assets / "leak.js").symlink_to(outside)
    srv = LocalServer(ROOT / "runtime", assets, good_scene(), {})
    with srv:
        assert _get(srv, "/assets/leak.js")[0] == 404


def test_headers_on_every_response(tmp_path):
    srv, _ = _server(tmp_path)
    with srv:
        for target, ctype in [("/scene.js", "text/javascript"), ("/runtime/harness.js", "text/javascript"),
                              ("/runtime/harness.html", "text/html"), ("/assets/core/core.js", "text/javascript"),
                              ("/media/img1", "image/png"), ("/_index.json", "application/json"),
                              ("/nope", "text/plain"), ("/assets/../x", "text/plain")]:
            status, h, _ = _get(srv, target)
            assert h["cache-control"] == "no-store", target
            assert h["content-security-policy"] == CSP, target
            assert h["content-type"].startswith(ctype), (target, h["content-type"])
    assert "default-src 'none'" in CSP and "script-src 'self'" in CSP and "connect-src 'self'" in CSP


def test_module_list_glob_manifest_and_fonts(tmp_path):
    g = list_asset_modules(ASSETS)
    assert g["source"] == "glob" and g["fonts_css"] is False
    assert g["modules"] == ["stub/box.js", "stub/label.js", "stub/pulse.js"]      # core/ excluded
    root = tmp_path / "a"
    for rel in ("core/core.js", "core/fonts.css", "_dev/x.js", "pack/a.js", "pack/b.js", "other.js"):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text("")
    assert list_asset_modules(root)["modules"] == ["other.js", "pack/a.js", "pack/b.js"]
    assert list_asset_modules(root)["fonts_css"] is True
    (root / "manifest.json").write_text('{"modules": ["pack/b.js", "../../etc/passwd.js", "missing.js"]}')
    m = list_asset_modules(root)
    assert m["source"] == "manifest" and m["modules"] == ["pack/b.js"]            # unsafe / missing entries dropped


def test_external_requests_are_blocked_and_reported(tmp_path):
    spec = load_spec(write_spec(tmp_path, good_scene()))
    with BrowserSession(spec) as s:
        page = s.new_page()
        # 1) a fetch from the page is stopped by the CSP and shows up as a console error
        res = page.page.evaluate("() => fetch('http://203.0.113.9/x').then(() => 'loaded', () => 'blocked')")
        assert res == "blocked"
        # 2) a navigation to another origin never leaves the machine: route abort, reported
        #    (separate page: the failed navigation leaves it on an error page)
        nav = s.new_page(load_harness=False)
        with pytest.raises(Exception):
            nav.page.goto("http://example.invalid/blocked-page")
        kinds = {e["kind"] for e in s.events}
        assert "blocked_request" in kinds and "console_error" in kinds
        assert any("example.invalid" in (e["url"] or "") for e in s.events if e["kind"] == "blocked_request")


def test_scene_over_200kb_is_rejected_before_loading(tmp_path):
    spec = load_spec(write_spec(tmp_path, SCENES / "huge.js"))
    with pytest.raises(SceneTooLarge):
        with BrowserSession(spec):
            pass


def test_session_shuts_everything_down_even_on_error(tmp_path):
    import os
    spec = load_spec(write_spec(tmp_path, good_scene()))
    holder = {}
    with pytest.raises(RuntimeError, match="boom"):
        with BrowserSession(spec) as s:
            s.new_page()
            holder["marker"] = s._marker.encode()
            holder["port"] = s._server.server_address[1]
            raise RuntimeError("boom")
    live = []
    for name in os.listdir("/proc"):
        if name.isdigit():
            try:
                if holder["marker"] in open(f"/proc/{name}/cmdline", "rb").read():
                    live.append(name)
            except OSError:
                pass
    assert live == []
    with pytest.raises(OSError):                       # server socket is closed
        http.client.HTTPConnection("127.0.0.1", holder["port"], timeout=2).request("GET", "/")
