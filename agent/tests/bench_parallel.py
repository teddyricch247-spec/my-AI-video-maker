#!/usr/bin/env python3
"""Parallel beats benchmark (no spend): N beats through the REAL engine/audio/pipeline with a scripted test model that has simulated
network latency per turn.  Shows what parallelism buys and what the heavy-subprocess gate does.

    python agent/tests/bench_parallel.py [--beats 4] [--concurrency 4] [--heavy 2] [--latency 1.5] [--baseline]

What it measures: wall time of the batch, the gate's observed maximum of simultaneous heavy tools (must never exceed --heavy), the
time beats spent waiting for the gate, and, with --baseline, the same batch run one beat at a time.
Reading it: model latency overlaps perfectly across beats (that is what parallelism is for); Chromium/ffmpeg work does not,
it is bounded by CPU cores, so on a small machine the batch is limited by the render work, not by the number of beats in flight.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
for p in (REPO / "agent" / "src", HERE, REPO / "shared" / "src", REPO / "engine" / "src", REPO / "audio" / "src", REPO / "pipeline" / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from fake_llm import FakeLLM  # noqa: E402

from vbeat_agent.beat import BeatRequest  # noqa: E402
from vbeat_agent.config import Settings  # noqa: E402
from vbeat_agent.runner import run_beats  # noqa: E402
from vbeat_agent.toolrun import HEAVY  # noqa: E402


class PerBeat:
    """One scripted model per beat (chosen by the 'Beat <idx>:' line of the first user message); counts calls in flight."""

    def __init__(self, template: FakeLLM):
        self.template, self.by_idx = template, {}
        self.inflight = self.max_inflight = 0

    async def model_info(self, model):
        return await self.template.model_info(model)

    async def chat(self, *, model, messages, **kw):
        first = next(m for m in messages if m["role"] == "user")
        idx = int(re.search(r"Beat (\d+):", str(first["content"])).group(1))
        llm = self.by_idx.setdefault(idx, self.template.clone())
        self.inflight += 1
        self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            return await llm.chat(model=model, messages=messages, **kw)
        finally:
            self.inflight -= 1


async def batch(n: int, concurrency: int, heavy: int, latency: float, root: Path, state: Path) -> dict:
    template = FakeLLM.from_file(HERE / "scripts" / "golden.json", default_delay_s=latency)
    llm = PerBeat(template)
    reqs = [BeatRequest(beat_dir=root / f"beat{i}", transcript=REPO / "examples" / "transcript.json", from_word=0, to_word=8, width=1280, height=720, idx=i,
                        title=f"bench {i}", model="bench/scripted") for i in range(n)]
    settings = Settings(api_key=None, state_dir=state, max_heavy=heavy, cache_dir=root / "cache")
    HEAVY.configure(heavy)
    HEAVY.reset_stats()
    t0 = time.monotonic()
    results = await run_beats(reqs, llm=llm, concurrency=concurrency, total_max_usd=5.0, settings=settings)
    wall = time.monotonic() - t0
    st = HEAVY.stats()
    return {"beats": n, "concurrency": concurrency, "heavy_limit": heavy, "latency_s": latency, "wall_s": round(wall, 1),
            "statuses": [r.status for r in results], "finals_ok": sum(1 for r in results if r.final_video and r.final_video.exists()),
            "max_model_calls_in_flight": llm.max_inflight, "heavy_max_seen": st["max_seen"], "heavy_calls": st["total"], "heavy_wait_s": st["waited_s"],
            "per_beat_run_wall_s": [round(r.run_wall_s, 1) for r in results]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--beats", type=int, default=4)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--heavy", type=int, default=max(1, (os.cpu_count() or 2) // 2), help="max simultaneous Chromium/ffmpeg tools (default cores/2)")
    ap.add_argument("--latency", type=float, default=1.5, help="simulated model latency per turn, seconds")
    ap.add_argument("--baseline", action="store_true", help="also run the batch one beat at a time for comparison (slow)")
    a = ap.parse_args()
    out: dict = {"cpu_count": os.cpu_count()}
    with tempfile.TemporaryDirectory(prefix="vbeat-bench-") as tmp:
        tmp_p = Path(tmp)
        if a.baseline:
            out["serial"] = asyncio.run(batch(a.beats, 1, a.heavy, a.latency, tmp_p / "serial", tmp_p / "state-serial"))
        out["parallel"] = asyncio.run(batch(a.beats, a.concurrency, a.heavy, a.latency, tmp_p / "parallel", tmp_p / "state-parallel"))
    par = out["parallel"]
    ok = all(s == "waiting_user" for s in par["statuses"]) and par["heavy_max_seen"] <= a.heavy
    if a.baseline:
        out["speedup"] = round(out["serial"]["wall_s"] / par["wall_s"], 2)
    out["ok"] = ok
    print(json.dumps(out, indent=2))
    cpu = os.cpu_count() or 1
    print(f"\n{par['beats']} beats, {par['concurrency']} at a time, heavy gate {par['heavy_limit']} on {cpu} CPU(s): {par['wall_s']} s wall; "
          f"heavy tools never exceeded {par['heavy_max_seen']} at once; beats waited {par['heavy_wait_s']} s in total for a render slot.", file=sys.stderr)
    if a.baseline:
        print(f"One at a time: {out['serial']['wall_s']} s  ->  speed-up x{out['speedup']}. "
              f"On {cpu} CPU(s) the gain comes from overlapping model latency; rendering is CPU-bound and does not shrink.", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
