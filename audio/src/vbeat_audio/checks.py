"""Audio checks A0-A9 on the raw cue output plus the cue log, and the report format read by AI agents.

Report = {"ok", "counts": {"error", "warn"}, "findings": [{"id","severity","t","message","data"}], "text"}.
ok means no error findings; info findings are not counted.
"""
from __future__ import annotations

import math

import numpy as np

from . import analysis as an
from .constants import SR

SEV_RANK = {"error": 0, "warn": 1, "info": 2}
DENSITY_WARN_S = 1.5  # warn above 1 event per 1.5 s on average
DENSITY_ERROR_S = 0.7  # error above 1 event per 0.7 s on average
GROUP_SPAN_S = 0.6  # a group counts ceil(span / 0.6) events
MAX_CUE_S = 1.2
COVER_S = 0.08
ANCHOR_S = 0.5


def mk_finding(fid, severity, t, message, data=None):
    """Build one finding dict (t in seconds or None)."""
    return {"id": fid, "severity": severity, "t": None if t is None else round(float(t), 3),
            "message": message, "data": data or {}}


def finding_line(f):
    """One line for an AI reader: 'A4 warn @2.10s: message'."""
    at = f" @{f['t']:.2f}s" if f.get("t") is not None else ""
    return f"{f['id']} {f['severity']}{at}: {f['message']}"


def make_report(findings):
    """Wrap findings into the report object (sorted: errors, warnings, info)."""
    fs = sorted(findings, key=lambda f: (SEV_RANK[f["severity"]], f["id"] != "A0", len(f["id"]), f["id"],
                                         f["t"] if f.get("t") is not None else -1.0))
    counts = {"error": sum(f["severity"] == "error" for f in fs), "warn": sum(f["severity"] == "warn" for f in fs)}
    return {"ok": counts["error"] == 0, "counts": counts, "findings": fs,
            "text": "\n".join(finding_line(f) for f in fs) if fs else "no findings"}


def _db(v):
    return 20 * math.log10(max(float(v), 1e-9))


def _runs(mask, min_len):
    """(start, length) of runs of True with length >= min_len."""
    if not mask.any():
        return []
    d = np.diff(np.concatenate(([0], mask.view(np.int8), [0])))
    s, e = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    return [(int(a), int(b - a)) for a, b in zip(s, e) if b - a >= min_len]


def check_length(raw_len, samples):
    """A1: returned array length differs from ctx.samples."""
    if raw_len == samples:
        return []
    diff = (raw_len - samples) / SR
    sev = "error" if abs(diff) > 1.0 else "warn"
    what = "longer" if diff > 0 else "shorter"
    fix = "trimmed" if diff > 0 else "padded with zeros"
    return [mk_finding("A1", sev, None, f"render() returned {raw_len} samples, {abs(diff):.3f}s {what} than "
                       f"ctx.samples={samples}; {fix}. Return m.render() so the length is exact",
                       {"returned": raw_len, "expected": samples})]


def check_validity(x, n_cues):
    """A2: NaN/inf, silence, or a raw peak so low that normalisation would amplify noise."""
    bad = ~np.isfinite(x)
    if bad.any():
        first = int(np.argmax(bad))
        return [mk_finding("A2", "error", first / SR, f"output contains {int(bad.sum())} NaN/inf samples (first at "
                           f"{first / SR:.3f}s); check divisions, log(0) and filter inputs", {"count": int(bad.sum())})]
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak < 1e-3:
        return [mk_finding("A2", "error", None, f"output is silent (raw peak {_db(peak):.0f} dBFS); add at least one "
                           "cue with m.add(...)", {"peak": peak})]
    if n_cues == 0 and an.rms(x) < 1e-3:
        return [mk_finding("A2", "error", None, "no cue was logged and the output has almost no energy",
                           {"rms": an.rms(x)})]
    if peak < 10 ** (-50 / 20):
        return [mk_finding("A2", "warn", None, f"raw peak is {_db(peak):.1f} dBFS (under -50 dBFS); normalisation will "
                           "amplify noise", {"peak": peak})]
    return []


def check_clipping(x):
    """A3: runs of 3+ consecutive samples stuck at the same extreme value."""
    hi, lo = float(x.max()), float(x.min())
    runs = []
    if hi > 1e-3:
        runs += _runs(x >= hi - 1e-12, 3)
    if lo < -1e-3:
        runs += _runs(x <= lo + 1e-12, 3)
    if not runs:
        return []
    runs.sort()
    longest = max(r[1] for r in runs)
    return [mk_finding("A3", "warn", runs[0][0] / SR, f"hard clipping: {len(runs)} runs of 3+ identical samples at the "
                       f"peak (longest {longest} samples); lower gain_db or use soft_clip", {"runs": len(runs), "longest": longest})]


def _events(cues, x):
    """[(onset_s, n_events)] from the cue log; energy-onset detection when the log is empty."""
    if not cues:
        return [(t, 1) for t in an.onsets(x)]
    out = []
    for c in cues:
        if c.get("kind") == "group":
            out.append((float(c["onset"]), max(1, int(math.ceil(float(c.get("span", 0.0)) / GROUP_SPAN_S)))))
        else:
            out.append((float(c["onset"]), 1))
    return sorted(out)


def check_density(cues, x, dur):
    """A4: too many sound events per second (single cue = 1, group = max(1, ceil(span/0.6)))."""
    ev = _events(cues, x)
    total = sum(n for _, n in ev)
    warn_lim = max(2.0, dur / DENSITY_WARN_S)
    err_lim = max(4.0, dur / DENSITY_ERROR_S)
    if total <= warn_lim:
        return []
    best_t, best = 0.0, 0
    for t0, _ in ev:
        c = sum(n for t, n in ev if t0 <= t < t0 + DENSITY_WARN_S)
        if c > best:
            best, best_t = c, t0
    sev = "error" if total > err_lim else "warn"
    return [mk_finding("A4", sev, best_t, f"{total} sound events in {dur:.1f}s (limit about {warn_lim:.0f}); "
                       "remove or group cues", {"events": total, "dur": dur, "limit": round(warn_lim, 2)})]


def check_bounds(cues, dur):
    """A5: cue cut by the beat edges, or an audible tail longer than 1.2 s."""
    out = []
    for c in cues:
        name = c.get("name", "?")
        if c.get("clipped_audible"):
            if c["onset"] < -0.001:
                out.append(mk_finding("A5", "warn", 0.0, f"cue '{name}' starts {-c['onset']:.2f}s before the beat start; "
                                      "its beginning was cut", {"cue": name}))
            if c["end"] > dur + 0.001:
                out.append(mk_finding("A5", "warn", c["onset"], f"cue '{name}' is audible until {c['end']:.2f}s, past the "
                                      f"beat end {dur:.2f}s; its end was cut", {"cue": name}))
        if c.get("audible_dur", 0.0) > MAX_CUE_S + 1e-9:
            out.append(mk_finding("A5", "warn", c["onset"], f"cue '{name}' is audible for {c['audible_dur']:.2f}s "
                                  f"(over {MAX_CUE_S}s, envelope above -50 dB); shorten it or fade it out",
                                  {"cue": name, "audible_dur": c["audible_dur"]}))
    return out


def check_spectrum(x):
    """A6: more than 25% of the energy under 50 Hz or more than 35% above 10 kHz."""
    if float(np.abs(x).max()) < 1e-3:
        return []
    fr = an.band_fractions(x - float(np.mean(x)), (0, 50, 10000, SR / 2 + 1))  # DC is reported by A10, not here
    out = []
    if fr[0] > 0.25:
        out.append(mk_finding("A6", "warn", None, f"{fr[0] * 100:.0f}% of the energy is below 50 Hz (limit 25%); raise "
                              "pitch or add highpass(x, 60)", {"below_50hz": fr[0]}))
    if fr[2] > 0.35:
        out.append(mk_finding("A6", "warn", None, f"{fr[2] * 100:.0f}% of the energy is above 10 kHz (limit 35%); add "
                              "lowpass(x, 9000)", {"above_10khz": fr[2]}))
    return out


def check_loudness(x, peak_dbfs):
    """A7 (info): raw level metrics; the runner normalises the peak anyway."""
    pk, r, ra = float(np.abs(x).max()), an.rms(x), an.rms_active(x)
    return [mk_finding("A7", "info", None, f"raw peak {_db(pk):.1f} dBFS, rms {_db(r):.1f} dBFS, active-window rms "
                       f"{_db(ra):.1f} dBFS; delivered peak will be {peak_dbfs:.1f} dBFS",
                       {"peak_dbfs": round(_db(pk), 2), "rms_dbfs": round(_db(r), 2), "active_rms_dbfs": round(_db(ra), 2)})]


def _cue_times(c):
    ts = [c.get("t"), c.get("onset"), c.get("peak_t")] + list(c.get("times") or [])
    return [float(t) for t in ts if t is not None]


def check_marker_coverage(markers, cues, x):
    """A8 (info): markers with no cue onset, peak or placement within +-80 ms."""
    times = [t for c in cues for t in _cue_times(c)] if cues else an.onsets(x)
    out = []
    for m in markers:
        if not any(abs(t - m["t"]) <= COVER_S for t in times):
            out.append(mk_finding("A8", "info", m["t"], f"marker '{m['id']}' ({m['kind']}) has no cue within +-80 ms",
                                  {"marker": m["id"], "kind": m["kind"]}))
    return out


def check_anchors(cues):
    """A9: a cue's anchor id is unknown or its time differs from the anchor's time by more than 0.5 s."""
    out = []
    for c in cues:
        a = c.get("anchor")
        if a is None:
            continue
        if not c.get("anchor_known", True):
            out.append(mk_finding("A9", "warn", c["t"], f"cue '{c['name']}' has anchor '{a}' which is not a marker or "
                                  "word id in this beat", {"cue": c["name"], "anchor": a}))
        elif abs(c["t"] - c["anchor_t"]) > ANCHOR_S:
            out.append(mk_finding("A9", "warn", c["t"], f"cue '{c['name']}' is at {c['t']:.2f}s but its anchor '{a}' is at "
                                  f"{c['anchor_t']:.2f}s ({abs(c['t'] - c['anchor_t']):.2f}s apart); fix t or the anchor",
                                  {"cue": c["name"], "anchor": a}))
    return out


def run_checks(x, spec, cues, raw_len=None, pre_findings=()):
    """Run A1-A9 on the length-fixed raw output x (float array) and the cue log; return the report.

    pre_findings (for example A0) are included; with an A0 the audio checks are skipped.
    """
    findings = list(pre_findings)
    if any(f["id"] == "A0" for f in findings) or x is None:
        return make_report(findings)
    x = np.asarray(x, dtype=np.float64)
    findings += check_length(len(x) if raw_len is None else raw_len, spec["samples"])
    a2 = check_validity(x, len(cues))
    findings += a2
    if any(f["severity"] == "error" for f in a2):
        return make_report(findings)
    findings += check_clipping(x)
    findings += check_density(cues, x, spec["dur"])
    findings += check_bounds(cues, spec["dur"])
    findings += check_spectrum(x)
    findings += check_loudness(x, spec["peak_dbfs"])
    findings += check_marker_coverage(spec["markers"], cues, x)
    findings += check_anchors(cues)
    return make_report(findings)
