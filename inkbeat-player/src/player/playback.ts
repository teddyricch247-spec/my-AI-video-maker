// The playback clock. Plays the transcript aloud with the browser's built-in voice (Web Speech API) and keeps the
// picture in step with it: the clock is re-anchored at every sentence start and, where the voice reports them, at
// every word. Without a voice (unsupported, muted by the OS) the same clock simply runs on the wall clock.
// Must be called straight from the click handler (iOS and Chrome only allow speech after a tap).
import type { Timeline } from "./timing";
import { wordAtChar } from "./timing";

export type PlaybackOpts = {
  tl: Timeline;
  /** BCP-47 language of the voice, default: the page language */
  lang?: string;
  /** called with the video time in seconds, once per 30 fps frame */
  onTime: (t: number) => void;
  onEnd: () => void;
};

const FPS = 30;

const pickVoice = (lang: string) => {
  const vs = window.speechSynthesis.getVoices();
  const base = lang.toLowerCase().split("-")[0];
  const match = vs.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
  // local voices report word boundaries (remote ones do not), so they keep the picture tighter
  return match.find((v) => v.localService) ?? match[0];
};

export const startPlayback = (o: PlaybackOpts): (() => void) => {
  const { tl } = o;
  const synth = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null;
  const speech = !!synth && tl.sentences.length > 0;

  let started = performance.now();
  let skew = 0; // seconds added to the wall clock; eased toward `target` so the picture never jumps
  let target = 0;
  let waiting = speech; // hold the first frame until the voice actually starts
  let spokeAll = !speech;
  let stopped = false;
  let raf = 0;
  let last = performance.now();
  let lastFrame = -1;

  const wall = () => (performance.now() - started) / 1000;
  const anchor = (tt: number) => {
    if (stopped) return;
    if (waiting) {
      waiting = false;
      started = performance.now() - tt * 1000;
      skew = target = 0;
    } else target = tt - wall();
  };

  if (speech && synth) {
    synth.cancel();
    const lang = o.lang ?? (document.documentElement.lang || "en");
    const voice = pickVoice(lang);
    tl.sentences.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s.text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else u.lang = lang;
      u.rate = 1;
      u.onstart = () => anchor(s.t0);
      u.onboundary = (e) => {
        if (e.name && e.name !== "word") return;
        const w = tl.words[wordAtChar(s, e.charIndex)];
        if (w) anchor(w[1]);
      };
      if (i === tl.sentences.length - 1) {
        u.onend = () => (spokeAll = true);
        u.onerror = () => (spokeAll = true);
      }
      synth.speak(u);
    });
    // no voice answered: run silently on the wall clock
    window.setTimeout(() => waiting && anchor(0), 1500);
  }

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    skew += (target - skew) * (1 - Math.exp(-dt / 0.25));
    const t = waiting ? 0 : Math.min(tl.duration, Math.max(0, wall() + skew));
    const f = Math.floor(t * FPS);
    if (f !== lastFrame) {
      lastFrame = f;
      o.onTime(f / FPS);
    }
    if (!waiting && t >= tl.duration && (spokeAll || wall() > tl.duration + 4)) {
      stop();
      o.onEnd();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    if (synth) synth.cancel();
  };

  raf = requestAnimationFrame(tick);
  return stop;
};
