"use client";
// THE PLAYER. A 9:16 video and one play button. Nothing else: no controls, no timeline, no download, no text.
// Leave this file alone; the story lives in src/video/.
import React, { useEffect, useRef, useState } from "react";
import { Captions, makeChunks } from "../inkbeat/core/captions";
import { useFonts } from "../inkbeat/core/frame";
import { Scene } from "../video/Scene";
import { ACCENT_WORDS, TL } from "../video/plan";
import { startPlayback } from "./playback";

const CHUNKS = makeChunks(TL.words, TL.duration);
const ACCENT = new Set(ACCENT_WORDS);
const LAST_END = TL.words.length ? TL.words[TL.words.length - 1][2] : 0;

type State = "idle" | "playing" | "ended";

const useViewport = () => {
  const [v, setV] = useState({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return v;
};

const VideoPlayer: React.FC = () => {
  const vp = useViewport();
  const fontsReady = useFonts();
  const [state, setState] = useState<State>("idle");
  const [t, setT] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  // the 9:16 stage, as large as fits
  const h = Math.floor(Math.min(vp.h, (vp.w * 16) / 9));
  const w = Math.floor((h * 9) / 16);
  // the drawing buffer: sharp, but light enough for a phone
  const cap = w < 520 ? 720 : 1080;
  const rw = Math.max(480, Math.min(cap, Math.round(w * Math.min(vp.dpr, 2.5))));
  const view = { width: rw, height: Math.round((rw * 16) / 9), dpr: w > 0 ? rw / w : 1 };

  const play = () => {
    if (state === "playing") return;
    stopRef.current?.();
    setT(0);
    setState("playing");
    // called straight from the tap: browsers only allow the voice after a user gesture
    stopRef.current = startPlayback({
      tl: TL,
      onTime: setT,
      onEnd: () => {
        setT(TL.duration);
        setState("ended");
      },
    });
  };

  const ready = fontsReady && w > 0 && h > 0;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: w, height: h, background: "#000", overflow: "hidden" }}>
        {ready ? <Scene t={t} view={view} /> : null}
        {ready && state === "playing" ? (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <Captions chunks={CHUNKS} t={t} accent={ACCENT} until={LAST_END + 0.35} width={w} height={h} />
          </div>
        ) : null}
        {ready && state !== "playing" ? (
          <button aria-label="Play" onClick={play} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <span
              style={{
                width: w * 0.22,
                height: w * 0.22,
                borderRadius: "50%",
                background: "rgba(18,10,16,0.62)",
                border: `${Math.max(2, w * 0.008)}px solid rgba(255,255,255,0.92)`,
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg viewBox="0 0 24 24" width="46%" height="46%" style={{ marginLeft: "6%" }}>
                <path d="M7 4.5v15l12.5-7.5z" fill="#fff" />
              </svg>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default VideoPlayer;
