import hashlib

import numpy as np
from PIL import Image

import helpers
from vbeat_audio import preview
from vbeat_audio import synth as S
from vbeat_audio.constants import SR

EX = helpers.ROOT / "sfx" / "examples"


def render(name, out):
    env = helpers.render_file(EX / f"{name}.py", name, out)
    assert env["ok"] and "preview" in env["artifacts"]
    return env


def test_dimensions_size_and_content(tmp_path):
    for name in ("stat_land", "story_market"):
        p = render(name, tmp_path / name)["artifacts"]["preview"]
        img = Image.open(p)
        assert img.size == (1200, 640) and img.format == "JPEG"
        assert (tmp_path / name / "sfx_preview.jpg").stat().st_size < 300 * 1024
        a = np.asarray(img.convert("RGB"), dtype=np.float64)
        assert a.std() > 25  # not blank
        spec = a[330:590, 90:1170]
        assert spec.max() > 200 and (spec.sum(axis=2) > 300).mean() > 0.002  # some energy drawn in the spectrogram
        wave = a[130:266, 90:1170]
        assert (wave[:, :, 0] > 200).sum() > 100  # waveform pixels


def test_preview_is_deterministic(tmp_path):
    h = [hashlib.sha256(open(render("title_stamp", tmp_path / str(i))["artifacts"]["preview"], "rb").read()).hexdigest() for i in range(2)]
    assert h[0] == h[1]


def test_time_axis_step_and_marker_triangles_do_not_crash():
    spec = {"fps": 30, "markers": [{"id": "a", "t": 0.5, "kind": k} for k in preview.KIND_LETTER]}
    x = np.zeros(SR * 9)
    x[SR: SR + 4800] = S.soft_pop()[:4800].astype(np.float64) if False else 0.2 * np.sin(np.arange(4800))
    assert preview._time_step(5.0) == 0.5 and preview._time_step(9.0) == 1.0
    import tempfile, os
    with tempfile.TemporaryDirectory() as d:
        n = preview.render_preview(x, spec, [{"name": "a_really_long_cue_name_that_is_cut", "onset": 1.0, "t": 1.0, "kind": "single"}], os.path.join(d, "p.jpg"))
        assert n < 300 * 1024


def test_catalog_grid_and_thumb(tmp_path):
    items = [(n, "sub", fn()) for n, fn in list(S.RECIPES.items())[:4]]
    n = preview.render_grid(items, tmp_path / "g.jpg")
    assert n > 10000 and Image.open(tmp_path / "g.jpg").size[0] == 1600
    preview.render_thumb(S.chime(), tmp_path / "t.jpg")
    assert Image.open(tmp_path / "t.jpg").size == (360, 170)


def test_colormap_is_warm_and_monotone_in_brightness():
    lut = preview.warm_lut().astype(int)
    lum = lut.sum(axis=1)
    assert np.all(np.diff(lum) >= -2) and lut[-1][0] > 240 and lut[0].sum() < 60
    assert lut[128][0] > lut[128][2]  # red channel dominates blue in the middle
