"""The ctx object handed to render(ctx) in cue scripts."""
from __future__ import annotations

import difflib
import zlib

import numpy as np

from .constants import SR
from .spec import validate_spec


class UnknownIdError(ValueError):
    """A word or marker id that does not exist in this beat (message lists the 5 nearest ids)."""


def _nearest(wanted, ids):
    return difflib.get_close_matches(str(wanted), list(ids), n=5, cutoff=0.0)


class Ctx:
    """Beat context for cue scripts. All times are beat-local seconds.

    Attributes: sr, fps, samples, dur, words ([{id,start,end}]), markers ([{id,t,kind}]), seed.
    """

    def __init__(self, spec: dict):
        spec = validate_spec(spec)
        self.sr = SR
        self.fps = spec["fps"]
        self.samples = spec["samples"]
        self.dur = spec["dur"]
        self.words = [dict(w) for w in spec["words"]]
        self.markers = [dict(m) for m in spec["markers"]]
        self.seed = spec["seed"]
        self.peak_dbfs = spec["peak_dbfs"]
        self._word_by_id = {w["id"]: w for w in self.words}
        self._marker_by_id = {m["id"]: m for m in self.markers}
        self._mixes = []

    def at(self, word_id, edge="start", offset=0.0):
        """Time in seconds of a word edge ('start' or 'end') plus offset (default 0.0 s)."""
        if edge not in ("start", "end"):
            raise ValueError("edge must be 'start' or 'end'")
        w = self._word_by_id.get(word_id)
        if w is None:
            raise UnknownIdError(self._unknown("word", word_id, self._word_by_id))
        return float(w[edge]) + float(offset)

    def marker(self, marker_id):
        """Time in seconds of the engine marker with this id."""
        m = self._marker_by_id.get(marker_id)
        if m is None:
            raise UnknownIdError(self._unknown("marker", marker_id, self._marker_by_id))
        return float(m["t"])

    def marker_times(self, kind):
        """Sorted list of marker times (seconds) of one kind, e.g. 'pop'."""
        return sorted(float(m["t"]) for m in self.markers if m["kind"] == kind)

    def rng(self, label=0):
        """Deterministic numpy Generator derived from the spec seed and a label (int or str)."""
        lab = label if isinstance(label, int) else zlib.crc32(str(label).encode("utf-8"))
        return np.random.default_rng(np.random.SeedSequence([int(self.seed) & 0xFFFFFFFF, int(lab) & 0xFFFFFFFF]))

    def mix(self):
        """New Mix bound to this beat (renders exactly ctx.samples samples)."""
        from .synth import Mix
        return Mix(self)

    # -- helpers for Mix / checks (not part of the documented cue API) --
    def _register_mix(self, mix):
        self._mixes.append(mix)

    def _anchor_time(self, anchor, t):
        """Time of an anchor id (marker, else nearest word edge to t) or None when unknown."""
        if anchor in self._marker_by_id:
            return float(self._marker_by_id[anchor]["t"])
        w = self._word_by_id.get(anchor)
        if w is None:
            return None
        return min((w["start"], w["end"]), key=lambda e: abs(e - t))

    def _unknown(self, what, wanted, table):
        if not table:
            return f"unknown {what} id {wanted!r}: this beat has no {what}s"
        return f"unknown {what} id {wanted!r}; nearest ids: {', '.join(_nearest(wanted, table))}"
