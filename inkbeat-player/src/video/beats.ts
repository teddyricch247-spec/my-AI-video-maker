// Camera beats generated from the transcript's words: about 56 a minute, sentence starts first, then clause starts,
// pushes outnumbering pulls 2:1. Moves start ~6 frames (0.2 s) before their word. Never type a time.
import type { Beat } from "../inkbeat/core/rig";
import type { Timeline } from "../player/timing";

const CYCLE = ["PUSH", "ORBIT_L", "PUSH", "DOLLY_R", "PULL", "PUSH", "ORBIT_R", "CRANE_UP", "PUSH", "DOLLY_L"];
const DUR: Record<string, number> = { PUSH: 0.63, PULL: 0.66, ORBIT_L: 0.7, ORBIT_R: 0.7, CRANE_UP: 0.7, CRANE_DOWN: 0.7, DOLLY_L: 0.75, DOLLY_R: 0.75 };

/** beats for the window [from, to) of a timeline. Keep a shot to 2-5 s (a sentence or two): beats accumulate within a shot. */
export const beatsFor = (tl: Timeline, from: number, to: number, perMin = 56, cycle: string[] = CYCLE): Beat[] => {
  const gap = 60 / perMin;
  const cands: { t: number; pri: number }[] = [];
  const starts = new Set(tl.sentences.map((s) => s.first));
  tl.words.forEach((w, i) => {
    const prev = tl.words[i - 1]?.[0] ?? "";
    const pri = starts.has(i) ? 2 : /[,;:—–]["'”’)\]]*$/.test(prev) ? 1 : 0;
    cands.push({ t: w[1] - 0.2, pri });
  });
  const out: Beat[] = [];
  let lastT = from;
  let k = 0;
  const end = to - 0.45;
  while (lastT + gap < end) {
    const want = lastT + gap;
    const near = cands
      .filter((c) => c.t >= want - 0.25 && c.t <= want + 0.3 && c.t > from + 0.15)
      .sort((a, b) => b.pri - a.pri || Math.abs(a.t - want) - Math.abs(b.t - want))[0];
    const t = near ? near.t : want;
    const move = cycle[k++ % cycle.length];
    out.push({ t: Math.round(t * 1000) / 1000, move, dur: DUR[move] ?? 0.63 });
    lastT = t;
  }
  return out;
};
