"use client";
import { Fragment, useEffect, useRef, useState } from "react";

/* Hero animation: a little "writing code" loop, just for fun.
   Tokens are [className, text]; "" means plain text. */
const LINES = [
  [["kw", "video"], ["", '("launch")']],
  [["", "  ."], ["kw", "scene"], ["", "("], ["st", '"title"'], ["", ")"]],
  [["", "  ."], ["kw", "scene"], ["", "("], ["st", '"growth"'], ["", ")"]],
  [["", "  ."], ["kw", "scene"], ["", "("], ["st", '"outro"'], ["", ")"]],
  [["", "  ."], ["kw", "theme"], ["", "("], ["st", '"indigo"'], ["", ")"]],
  [["", "  ."], ["kw", "render"], ["", "("], ["nu", "1080"], ["", ")"]],
];
const LENS = LINES.map((t) => t.reduce((a, [, s]) => a + s.length, 0));
const BARS = [30, 48, 44, 75, 100];

function Line({ tokens, n }) {
  let left = n;
  return tokens.map(([cls, text], i) => {
    const s = text.slice(0, Math.max(0, left));
    left -= text.length;
    if (!s) return null;
    return cls ? <span key={i} className={cls}>{s}</span> : <Fragment key={i}>{s}</Fragment>;
  });
}

export default function HeroStage() {
  const ref = useRef(null);
  const [typed, setTyped] = useState(() => LINES.map(() => 0));
  const [caret, setCaret] = useState(-1);
  const [act, setAct] = useState(-1);
  const [scene, setScene] = useState(-1);
  const [status, setStatus] = useState("Writing code…");
  const [go, setGo] = useState(false);

  useEffect(() => {
    let alive = true;
    let vis = true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const io = new IntersectionObserver((e) => { vis = e[0].isIntersecting; });
    io.observe(ref.current);
    const wait = async (ms) => {
      await sleep(ms);
      while (alive && (!vis || document.hidden)) await sleep(300);
    };

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(LENS.slice());
      setScene(2);
      setStatus("✓ Ready to download");
      return () => io.disconnect();
    }

    (async () => {
      while (alive) {
        setScene(-1); setGo(false); setAct(-1); setTyped(LINES.map(() => 0));
        setStatus("Writing code…");
        await wait(600);
        for (let i = 0; i < LINES.length && alive; i++) {
          setCaret(i);
          for (let c = 1; c <= LENS[i] && alive; c++) {
            setTyped((t) => { const a = t.slice(); a[i] = c; return a; });
            await wait(26);
          }
          await wait(130);
        }
        if (!alive) return;
        setStatus("Rendering 1080p…");
        await wait(800);
        setCaret(-1); setStatus("▶ Preview"); setGo(true);
        for (let k = 0; k < 3 && alive; k++) {
          setAct(k + 1); setScene(k);
          await wait(2200);
        }
        setAct(-1); setStatus("✓ Ready to download");
        await wait(1800);
      }
    })();

    return () => { alive = false; io.disconnect(); };
  }, []);

  return (
    <div className="stage" ref={ref}>
      <div className="frame">
        <div className="bar"><s /><s /><s /></div>
        <div className="split">
          <div className="code" aria-hidden="true">
            {LINES.map((tokens, i) => (
              <p key={i} className={act === i ? "act" : undefined}>
                <Line tokens={tokens} n={typed[i]} />
                {caret === i && <i className="caret" />}
              </p>
            ))}
          </div>
          <div className="view" aria-hidden="true">
            <span className="status">{status}</span>
            <div className={"sc" + (scene === 0 ? " on" : "")}>
              <h4>Ship<br /><b>faster.</b></h4>
            </div>
            <div className={"sc" + (scene === 1 ? " on" : "")}>
              <div>
                <h4><b>+212%</b><br />more views</h4>
                <div className="mini">
                  {BARS.map((h, i) => <i key={i} style={{ "--h": h + "%", "--i": i }} />)}
                </div>
              </div>
            </div>
            <div className={"sc" + (scene === 2 ? " on" : "")}>
              <div>
                <h4>Your video<br />is <b>ready.</b></h4>
                <span className="dl">Download MP4</span>
              </div>
            </div>
            <div className={"track" + (go ? " go" : "")}><b /></div>
          </div>
        </div>
      </div>
      <div className="glass g1"><b>72 hrs</b>average delivery</div>
      <div className="glass g2"><b>1080p</b>MP4, yours to keep</div>
    </div>
  );
}
