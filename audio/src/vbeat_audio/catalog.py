"""demo material for a human listener: every recipe and example as wav + spectrogram, and demo/audition.html."""
from __future__ import annotations

import html
import shutil
import tempfile
from pathlib import Path

import numpy as np

from . import analysis, api, checks, preview, runner, synth
from .constants import SR
from .ctx import Ctx
from .spec import build_spec

REPO = Path(__file__).resolve().parents[2]
LEAD_S = 0.05


def _recipe_beat(x):
    """SFX spec for a beat that holds one recipe sound (30 fps) so the real checks can run on it."""
    frames = int(np.ceil((len(x) / SR + LEAD_S + 0.1) * 30))
    return build_spec({"project": {"fps": 30}, "beat": {"f0": 0, "f1": frames}, "words": []}, [])


def check_recipe(x):
    """Run the checks on a recipe sound placed at 50 ms in its own beat; returns the report."""
    spec = _recipe_beat(x)
    ctx = Ctx(spec)
    m = ctx.mix()
    m.add(LEAD_S, x, name="recipe")
    return checks.run_checks(m.render().astype(np.float64), spec, m.cues, spec["samples"])


def _row(d):
    return (f"<td>{d['duration'] * 1000:.0f} ms</td><td>{d['centroid_hz']:.0f} Hz</td>"
            f"<td>{d['attack_ms']:.1f} ms</td><td>{d['decay_ms']:.0f} ms</td><td>{d['peak_dbfs']:.1f} dBFS</td>")


def _card(name, wav, img, d):
    n = html.escape(name)
    return (f'<div class="card"><h3>{n}</h3><audio controls preload="none" src="{html.escape(wav)}"></audio>'
            f'<table><tr><th>length</th><th>centroid</th><th>attack</th><th>decay -30 dB</th><th>peak</th></tr>'
            f'<tr>{_row(d)}</tr></table><img alt="spectrogram of {n}" src="{html.escape(img)}"></div>')


def _page(recipes, examples):
    css = ("body{background:#14100e;color:#f0e8dc;font:16px/1.4 system-ui,sans-serif;margin:24px;max-width:1200px}"
           "h1,h2{font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px}"
           ".card{background:#221a16;border:1px solid #3a2e27;border-radius:8px;padding:12px}.card h3{margin:0 0 8px}"
           "audio{width:100%}table{width:100%;font-size:13px;margin:8px 0;border-collapse:collapse}"
           "th{color:#a8987f;font-weight:500;text-align:left}img{width:100%;border-radius:4px}p.note{color:#a8987f}")
    parts = ["<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>vbeat audio audition</title>",
             f"<style>{css}</style></head><body><h1>vbeat audio audition</h1>",
             "<p class=\"note\">Every sound is synthesised. Press play to judge by ear; the numbers are only hints. "
             "All files are normalised to -6 dBFS peak.</p>", "<h2>Recipes</h2><div class=\"grid\">"]
    parts += [_card(n, w, i, d) for n, w, i, d in recipes]
    parts += ["</div><h2>Examples (full cue scripts on their fixture beats)</h2><div class=\"grid\">"]
    parts += [_card(n, w, i, d) for n, w, i, d in examples]
    parts.append("</div></body></html>")
    return "\n".join(parts)


def build_catalog(out, progress=lambda m: None):
    """Render all recipes and examples under `out`; returns (artifacts, report)."""
    out = Path(out)
    rec_dir, ex_dir = out / "recipes", out / "examples"
    for d in (rec_dir, rec_dir / "_thumbs", ex_dir):
        d.mkdir(parents=True, exist_ok=True)
    findings, recipes, grid = [], [], []
    for name, fn in synth.RECIPES.items():
        progress(f"recipe {name}")
        x = fn()
        rep = check_recipe(x)
        findings += [dict(f, message=f"[recipe {name}] {f['message']}") for f in rep["findings"] if f["severity"] != "info"]
        final, pcm, _ = runner.finalize(x, {"peak_dbfs": -6.0})
        runner.write_wav(rec_dir / f"{name}.wav", pcm)
        preview.render_thumb(final, rec_dir / "_thumbs" / f"{name}.jpg")
        d = analysis.descriptors(final)
        recipes.append((name, f"recipes/{name}.wav", f"recipes/_thumbs/{name}.jpg", d))
        grid.append((name, f"fc {d['centroid_hz']:.0f} Hz  att {d['attack_ms']:.1f} ms  dec {d['decay_ms']:.0f} ms", final))
    preview.render_grid(grid, rec_dir / "_catalog.jpg")
    examples = []
    src_dir, fx = REPO / "sfx" / "examples", REPO / "tests" / "fixtures" / "specs"
    if not src_dir.is_dir() or not fx.is_dir():
        raise FileNotFoundError(f"catalog needs the source checkout (sfx/examples and tests/fixtures/specs under {REPO})")
    for cue in sorted(src_dir.glob("*.py")):
        name = cue.stem
        progress(f"example {name}")
        with tempfile.TemporaryDirectory(prefix="vbeat_cat_") as tmp:
            env = api.render(fx / f"{name}.json", cue, tmp)
            rep = env["report"] or {"findings": []}
            findings += [dict(f, message=f"[example {name}] {f['message']}") for f in rep["findings"] if f["severity"] != "info"]
            if "wav" not in env["artifacts"]:
                continue
            shutil.copy(env["artifacts"]["wav"], ex_dir / f"{name}.wav")
            shutil.copy(env["artifacts"]["preview"], ex_dir / f"{name}.jpg")
            import wave
            with wave.open(str(ex_dir / f"{name}.wav")) as w:
                final = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
            examples.append((name, f"examples/{name}.wav", f"examples/{name}.jpg", analysis.descriptors(final)))
    (out / "audition.html").write_text(_page(recipes, examples), encoding="utf-8")
    arts = {"audition": str(out / "audition.html"), "catalog_image": str(rec_dir / "_catalog.jpg"),
            "recipes": str(rec_dir), "examples": str(ex_dir)}
    return arts, checks.make_report(findings)
