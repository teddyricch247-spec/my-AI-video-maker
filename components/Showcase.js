"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Clouds from "./Clouds";

/* ── PLACEHOLDER REEL ───────────────────────────────────────────
   To use a real video: drop your file in /public (e.g. public/showreel.mp4)
   and set VIDEO_SRC = "/showreel.mp4". The animated placeholder reel,
   its style tabs and the "Placeholder reel" badge are then replaced by it. */
const VIDEO_SRC = "";

const STYLES = [
  { slug: "kinetic", name: "Kinetic type" },
  { slug: "demo", name: "Product demo" },
  { slug: "data", name: "Data story" },
  { slug: "code", name: "Code explainer" },
];
const DUR = 5000;

const CODE = [
  [["k", "const"], ["", " reel = "], ["f", "video"], ["", "("], ["s", '"launch"'], ["", ")"]],
  [["", "  ."], ["f", "scene"], ["", "("], ["s", '"title"'], ["", ", "], ["s", '"Ship faster"'], ["", ")"]],
  [["", "  ."], ["f", "animate"], ["", "("], ["s", '"rise"'], ["", ", "], ["n", "0.8"], ["", ")"]],
  [["", "  ."], ["f", "theme"], ["", "("], ["s", '"indigo"'], ["", ")"]],
  [["", "reel."], ["f", "render"], ["", "("], ["n", "1080"], ["", ")"]],
];
const Tokens = ({ t }) =>
  t.map(([c, s], i) => (c ? <b key={i} className={c}>{s}</b> : s));

export default function Showcase() {
  const [cur, setCur] = useState(0);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [seen, setSeen] = useState(false);
  const [n, setN] = useState(0);
  const el = useRef(0);
  const playerRef = useRef(null);

  const show = (k) => { el.current = 0; setCur(k); setRun((r) => r + 1); };

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);

  useEffect(() => {
    if (!playerRef.current) return;
    const io = new IntersectionObserver((e) => setSeen(e[0].isIntersecting), { threshold: 0.35 });
    io.observe(playerRef.current);
    return () => io.disconnect();
  }, []);

  // advance only while visible, tab active and not paused
  useEffect(() => {
    const t = setInterval(() => {
      if (!seen || paused || document.hidden) return;
      el.current += 100;
      if (el.current >= DUR) { el.current = 0; setCur((c) => (c + 1) % 4); setRun((r) => r + 1); }
    }, 100);
    return () => clearInterval(t);
  }, [seen, paused]);

  // count-up for the Data story scene
  useEffect(() => {
    if (cur !== 2) return;
    const t0 = Date.now();
    setN(0);
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 1300);
      setN(Math.round(212 * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [cur, run]);

  const on = (i) => (cur === i ? " on" : "");
  const hasVideo = !!VIDEO_SRC;

  return (
    <section aria-labelledby="show-h">
      <div className={"show" + (hasVideo ? " has-video" : "")} id="showcase">
        <Clouds soft />
        <div className="show-in">
          <div className="head">
            <h2 id="show-h">See what we can make for you</h2>
            <p>
              Four styles, all built in code so they stay sharp at any size. Tap a style to preview
              it, then order the one you like.
            </p>
          </div>

          <div
            ref={playerRef}
            className={"player" + (hasVideo ? " has-video" : "") + (paused ? " paused" : "") + (seen ? "" : " out")}
            role="group"
            aria-label="Example video reel"
          >
            {hasVideo ? (
              <video src={VIDEO_SRC} muted loop playsInline autoPlay aria-label="Showreel of example videos" />
            ) : (
              <div className="reel">
                <div className={"scene s1" + on(0)}>
                  <div className="kt">
                    {["Your idea.", "In motion.", "Delivered."].map((t, i) => (
                      <span key={i}><b style={{ "--d": i }}>{t}</b></span>
                    ))}
                  </div>
                  <i className="orb o1" /><i className="orb o2" />
                </div>

                <div className={"scene s2" + on(1)}>
                  <div className="app">
                    <div className="app-top"><i /><em>Taskly</em><u>Today</u></div>
                    <div className="rows">
                      {["Done", "Done", "New"].map((u, i) => (
                        <div className="row" style={{ "--d": i }} key={i}>
                          <i /><div style={{ flex: 1 }}><b /><s /></div><u>{u}</u>
                        </div>
                      ))}
                    </div>
                    <div className="app-foot"><span className="go">Create report</span></div>
                  </div>
                  <div className="toast-m"><i>✓</i> Report created</div>
                  <svg className="cursor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 2l16 9-7 2-3 7z" fill="#0f1633" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </div>

                <div className={"scene s3" + on(2)}>
                  <div>
                    <div className="big" role="img" aria-label="Plus 212 percent">+{n}%</div>
                    <div className="cap">more views<small>in the first week after launch</small></div>
                  </div>
                  <div className="chart" aria-hidden="true">
                    {[26, 38, 34, 56, 78, 100].map((h, i) => <i key={i} style={{ "--h": h + "%", "--d": i }} />)}
                  </div>
                </div>

                <div className={"scene s4" + on(3)}>
                  <div className="ed" aria-hidden="true">
                    {CODE.map((t, i) => (
                      <span key={i} style={{ "--c": t.reduce((a, [, s]) => a + s.length, 0), "--d": i }}>
                        <Tokens t={t} />
                      </span>
                    ))}
                  </div>
                  <div className="term" aria-hidden="true">
                    <span style={{ "--d": 0 }}>$ reel render --1080</span>
                    <span style={{ "--d": 1 }}><em>✓</em> Rendered in 4.2s</span>
                    <span style={{ "--d": 2 }}><em>✓</em> Saved to your account</span>
                  </div>
                </div>

                <span className="rtag">{STYLES[cur].name}</span>
                <span className="rbadge">Placeholder reel</span>
                <div className="segs" aria-hidden="true">
                  {STYLES.map((_, i) => (
                    <i key={i + "-" + (i === cur ? run : "x")} className={"seg" + (i < cur ? " done" : i === cur ? " on" : "")} />
                  ))}
                </div>
                <button
                  className="pp"
                  type="button"
                  aria-label={paused ? "Play reel" : "Pause reel"}
                  onClick={() => setPaused((p) => !p)}
                >
                  <svg className="i-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                  <svg className="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
                </button>
              </div>
            )}
          </div>

          {!hasVideo && (
            <div className="reel-nav" role="group" aria-label="Choose an example style">
              {STYLES.map((s, i) => (
                <button key={s.slug} className="rchip" type="button" aria-pressed={cur === i} onClick={() => show(i)}>
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <div className="reel-cta">
            {hasVideo ? (
              <Link className="btn lime" href="/order">Order your video <span className="arr">→</span></Link>
            ) : (
              <Link className="btn lime" href={"/order?style=" + STYLES[cur].slug}>
                Order <span className="lbl-s">{STYLES[cur].name}</span> <span className="arr">→</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
