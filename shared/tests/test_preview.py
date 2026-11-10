import pytest

from vbeat_shared import preview as pv


def spec(frames=121, fps=30):
    return {"project": {"fps": fps, "width": 1920, "height": 1080}, "beat": {"idx": 0, "f0": 0, "f1": frames},
            "words": [{"id": "w0001", "text": "a", "start_ms": 0, "end_ms": 100, "f0": 0, "f1": 3}],
            "scene": "/srv/render/scene.js", "assets_dir": "/srv/render/assets", "media": {"photo": "/srv/render/media/p.png"}, "params": {"x": 1}}


def test_bundle_is_valid_and_keeps_server_paths_out():
    b = pv.build_preview_bundle(spec(), scene_url="/preview/scene/b1/1.js", media_urls={"photo": "/preview/media/b1/photo"})
    assert pv.validate_bundle(b) == []
    assert (b["fps"], b["frames"], b["width"], b["height"]) == (30, 121, 960, 540) and abs(b["dur"] - 121 / 30) < 1e-12
    assert "/srv/" not in repr(b) and b["spec"]["params"] == {"x": 1} and b["spec"]["media"] == b["media"]
    assert b["runtime_url"] == "/preview/runtime/runtime.js" and b["assets_base_url"] == "/preview/"


def test_validation_catches_what_would_break_the_runtime():
    good = pv.build_preview_bundle(spec(), scene_url="/s.js")
    for mutate in (lambda b: b.update(frames=5), lambda b: b.update(width=1000), lambda b: b.update(assets_base_url="/preview"),
                   lambda b: b.update(runtime_url="/other/runtime.js"), lambda b: b["spec"].update(scene="/x"), lambda b: b.update(scene_url="http://x/s.js"),
                   lambda b: b.update(media={"a": "/m"}), lambda b: b.pop("wav_url")):
        b = {**good, "spec": dict(good["spec"]), "media": dict(good["media"])}
        mutate(b)
        assert pv.validate_bundle(b), mutate


def test_width_rules_and_prefix_rules():
    for w in (0, 1281, 970):
        with pytest.raises(ValueError):
            pv.build_preview_bundle(spec(), scene_url="/s.js", width=w)
    with pytest.raises(ValueError):
        pv.engine_urls("preview/")
    assert pv.engine_urls("/p/")["runtime_url"] == "/p/runtime/runtime.js"


def test_headers_say_what_the_sandboxed_frame_needs():
    assert pv.PREVIEW_CORS["Access-Control-Allow-Origin"] == "*" and pv.PREVIEW_CORS["Cross-Origin-Resource-Policy"] == "cross-origin"
    assert "sandbox allow-scripts" in pv.FRAME_CSP and "unsafe-eval" not in pv.FRAME_CSP and "default-src 'none'" in pv.FRAME_CSP
    assert "frame-ancestors 'self'" in pv.FRAME_CSP
