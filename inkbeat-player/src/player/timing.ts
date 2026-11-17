// Word timings ESTIMATED from the transcript text (there is no audio file). Everything in the video is anchored to
// these words, never to typed seconds: change the transcript and the whole plan moves with it.
// While the browser voice reads the transcript, playback.ts re-anchors the clock to the voice's real sentence and
// word starts, so the picture stays in step even though these numbers are estimates.

/** [text, onset s, end s]: the same shape core/captions.tsx expects */
export type Word = [string, number, number];
export type Sentence = {
  text: string;
  t0: number;
  t1: number;
  /** index of its first word in Timeline.words */
  first: number;
  count: number;
  /** character offset of each of its words inside `text` (to map speech boundary events to words) */
  offsets: number[];
};
export type Timeline = { words: Word[]; sentences: Sentence[]; duration: number };

const ABBR = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no)\.$/i;
const CLOSERS = `["'”’)\\]]*`;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const count = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").length + (w.match(/\d/g) ?? []).length * 0.8;
const wordDur = (w: string) => Math.max(0.16, 0.13 + 0.045 * count(w));
const pauseAfter = (w: string) =>
  new RegExp(`(\\.\\.\\.|…)${CLOSERS}$`).test(w) ? 0.34
  : new RegExp(`[.!?]${CLOSERS}$`).test(w) ? 0.4
  : new RegExp(`[;:—–]${CLOSERS}$`).test(w) ? 0.26
  : new RegExp(`,${CLOSERS}$`).test(w) ? 0.2
  : 0.04;

export const buildTimeline = (transcript: string): Timeline => {
  const paras = transcript.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const words: Word[] = [];
  const sentences: Sentence[] = [];
  let t = 0;
  for (const para of paras) {
    const toks = para.split(" ");
    let text = "";
    let first = 0;
    let t0 = 0;
    let offsets: number[] = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      if (!text) {
        first = words.length;
        t0 = t;
        offsets = [];
      }
      offsets.push(text ? text.length + 1 : 0);
      text += (text ? " " : "") + tok;
      const d = wordDur(tok);
      words.push([tok, r3(t), r3(t + d)]);
      t += d + pauseAfter(tok);
      const next = toks[i + 1];
      const ends = new RegExp(`[.!?…]${CLOSERS}$`).test(tok) && !ABBR.test(tok) && (!next || /^["'“‘(\[]*[\p{Lu}\p{N}]/u.test(next));
      if (ends || !next) {
        sentences.push({ text, t0: r3(t0), t1: words[words.length - 1][2], first, count: words.length - first, offsets });
        text = "";
      }
    }
    t += 0.3; // paragraph break
  }
  const last = words[words.length - 1];
  return { words, sentences, duration: r3((last ? last[2] : 0) + 0.7) };
};

/** the same normalization as core/captions.tsx */
export const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "");

/** the onset (s) of the nth occurrence of a word or a short phrase ("the key", "ten years"). Plan anchors use this. */
export const anchorOf = (tl: Timeline, phrase: string, nth = 1): number => {
  const parts = phrase.split(/\s+/).map(norm).filter(Boolean);
  let k = 0;
  for (let i = 0; i + parts.length <= tl.words.length; i++) {
    if (parts.every((p, j) => norm(tl.words[i + j][0]) === p) && ++k === nth) return tl.words[i][1];
  }
  if (typeof console !== "undefined") console.warn(`anchorOf: "${phrase}" #${nth} is not in the transcript`);
  return 0;
};

/** true while a word is being said (for mouths: toggle at most ~2 Hz) */
export const speakingAt = (tl: Timeline, t: number) => tl.words.some((w) => t >= w[1] - 0.02 && t <= w[2]);

/** the word index (into Timeline.words) at a character index of a sentence's text */
export const wordAtChar = (s: Sentence, charIndex: number) => {
  let k = 0;
  for (let i = 0; i < s.offsets.length; i++) if (s.offsets[i] <= charIndex) k = i;
  return s.first + k;
};
