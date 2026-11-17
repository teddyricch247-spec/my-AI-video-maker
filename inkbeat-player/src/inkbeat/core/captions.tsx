// Burned-in Shorts captions: 1–2 lowercase words per chunk (2 when both are short and not across a sentence end),
// swapped instantly on each chunk's onset, shown 2 frames early, held until the next onset; spoken punctuation kept.
// A heavy geometric sans (Poppins ExtraBold) 92 px at 1080 wide, a heavy dark stroke drawn under the fill, a soft
// shadow, centered at 70% of the frame height. Every word is white by default. An accent color is optional: pass
// `accentColor` and the few key words in `accent` (at most one per chunk, about one per sentence).
import React from "react";

export type Word = [string, number, number]; // text, onset s, end s
export type Chunk = { words: string[]; a: number; b: number };
const letters = (w: string) => w.replace(/[^a-z0-9]/gi, "").length;

export const makeChunks = (words: Word[], pictureEnd: number, fps = 30): Chunk[] => {
  const out: Chunk[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const n = words[i + 1];
    const endsSentence = /[.?!,]$/.test(w[0]);
    const two = !!n && !endsSentence && letters(w[0]) <= 4 && letters(n[0]) <= 5 && letters(w[0]) + letters(n[0]) <= 9;
    const ws = two ? [w[0], n[0]] : [w[0]];
    out.push({ words: ws.map((x) => x.toLowerCase()), a: w[1] - 2 / fps, b: 0 });
    i += ws.length;
  }
  out.forEach((c, k) => (c.b = k + 1 < out.length ? out[k + 1].a : pictureEnd));
  return out;
};

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "");

export const Captions: React.FC<{
  chunks: Chunk[];
  t: number;
  /** optional: key words drawn in `accentColor` (normalized, lowercase); no effect while accentColor is white */
  accent?: Set<string>;
  accentColor?: string;
  /** hide after this time (the last word's end + ~0.35 s) */
  until?: number;
  width?: number;
  height?: number;
}> = ({ chunks, t, accent = new Set(), accentColor = "#ffffff", until = Infinity, width = 1080, height = 1920 }) => {
  const c = chunks.find((x) => t >= x.a && t < x.b);
  if (!c || t > until) return null;
  const k = width / 1080;
  let used = false; // one accent word per chunk at most
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: height * 0.7 - 70 * k, height: 140 * k, display: "flex", justifyContent: "center", alignItems: "center", gap: 26 * k }}>
      {c.words.map((w, i) => {
        const key = !used && accent.has(norm(w));
        if (key) used = true;
        return (
          <span key={i} style={{ fontFamily: "Poppins", fontWeight: 800, fontSize: 92 * k, lineHeight: 1, color: key ? accentColor : "#ffffff", WebkitTextStroke: `${14 * k}px #120a10`, paintOrder: "stroke fill", textShadow: `0 ${8 * k}px ${18 * k}px rgba(0,0,0,0.55)` }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};
