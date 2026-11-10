"""Shared helpers for the tests (plain functions, no fixtures, so they run under pytest and the minimal shim)."""
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402

from vbeat_audio import api  # noqa: E402
from vbeat_audio.spec import load_spec  # noqa: E402

FIX = ROOT / "tests" / "fixtures"
EXAMPLES = sorted(p.stem for p in (ROOT / "sfx" / "examples").glob("*.py"))


def spec(name="base5"):
    return load_spec(FIX / "specs" / f"{name}.json")


def bad(name):
    return FIX / "bad" / f"{name}.py"


def severe_ids(report):
    """IDs of error and warn findings (info excluded)."""
    return {f["id"] for f in report["findings"] if f["severity"] in ("error", "warn")}


def render_file(cue, spec_name, out, **kw):
    return api.render(FIX / "specs" / f"{spec_name}.json", cue, out, **kw)


def render_src(source, out, spec_name="base5", **kw):
    return api.render(FIX / "specs" / f"{spec_name}.json", None, out, source=source, **kw)


def read_wav(path):
    with wave.open(str(path)) as w:
        return w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate(), \
            np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
