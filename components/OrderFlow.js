"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Clouds from "./Clouds";
import Nav from "./Nav";
import Footer from "./Footer";

/* Prototype only: everything lives in React state. Nothing is sent or stored. */
const PLANS = {
  single: { name: "Single", price: 149, lens: ["15 seconds", "30 seconds"], edits: "2", txt: "You can request up to two rounds of edits, then download the MP4." },
  pack: { name: "Pack of 3", price: 399, lens: ["15 seconds", "30 seconds"], edits: "2 each", txt: "Each video includes up to two rounds of edits." },
  long: { name: "Long form", price: 299, lens: ["60 seconds", "90 seconds"], edits: "3", txt: "You can request up to three rounds of edits, then download the MP4." },
};
const STYLES = { kinetic: "Kinetic type", demo: "Product demo", data: "Data story", code: "Code explainer" };
const STEPS = ["Style", "Details", "Payment", "Account"];

const V = {
  goal: (v) => v.trim().length > 0,
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.trim()),
  cname: (v) => v.trim().length >= 2,
  cnum: (v) => { const d = v.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19; },
  cexp: (v) => { const m = /^(0[1-9]|1[0-2])\/(\d\d)$/.exec(v); return !!m && new Date(2000 + +m[2], +m[1], 1) > new Date(); },
  ccvc: (v) => /^\d{3,4}$/.test(v),
  apw: (v) => v.length >= 8,
};
const MSG = {
  goal: "Tell us briefly what the video is for.",
  email: "Enter a valid email address, like you@example.com.",
  cname: "Enter the name shown on the card.",
  cnum: "Enter the 13 to 19 digit number on the front of the card.",
  cexp: "Use MM/YY with a date that hasn’t passed.",
  ccvc: "Enter the 3 or 4 digit security code.",
  apw: "Use at least 8 characters.",
};
const FMT = {
  cnum: (v) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "),
  cexp: (v) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; },
  ccvc: (v) => v.replace(/\D/g, ""),
};

export default function OrderFlow() {
  const params = useSearchParams();
  const [step, setStep] = useState(1);
  const [style, setStyle] = useState("kinetic");
  const [plan, setPlan] = useState("single");
  const [lenSel, setLenSel] = useState("");
  const [f, setF] = useState({ goal: "", notes: "", col: "#4a43e8", email: "", cname: "", cnum: "", cexp: "", ccvc: "", apw: "" });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [oid, setOid] = useState("");
  const head = useRef(null);
  const prev = useRef(null);
  const fromLink = useRef(false);

  // arriving from the homepage with ?style=… / ?plan=…
  const qs = params.toString();
  useEffect(() => {
    const q = new URLSearchParams(qs);
    const s = q.get("style");
    const p = q.get("plan");
    if (p && PLANS[p]) setPlan(p);
    if (s && STYLES[s]) { fromLink.current = true; setStyle(s); setStep(2); }
  }, [qs]);

  // move focus to the new step's heading
  useEffect(() => {
    if (prev.current === null) { prev.current = step; return; }
    if (prev.current === step) return;
    prev.current = step;
    if (fromLink.current) { fromLink.current = false; return; }
    head.current?.focus({ preventScroll: true });
    head.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [step]);

  const p = PLANS[plan];
  const len = p.lens.includes(lenSel) ? lenSel : p.lens[0];

  const set = (k, v) => {
    setF((o) => ({ ...o, [k]: v }));
    if (errs[k]) setErrs((e) => ({ ...e, [k]: !V[k](v) }));
  };
  const blur = (k) => { if (f[k] || errs[k]) setErrs((e) => ({ ...e, [k]: !V[k](f[k]) })); };
  const check = (keys) => {
    const e = { ...errs };
    let firstBad = null;
    keys.forEach((k) => { const bad = !V[k](f[k]); e[k] = bad; if (bad && !firstBad) firstBad = k; });
    setErrs(e);
    if (firstBad) document.getElementById(firstBad)?.focus();
    return !firstBad;
  };
  const field = (k, label, extra = {}) => (
    <div className={"field" + (errs[k] ? " bad" : "")}>
      <label htmlFor={k}>{label}</label>
      <input
        id={k}
        value={f[k]}
        onChange={(e) => set(k, FMT[k] ? FMT[k](e.target.value) : e.target.value)}
        onBlur={() => blur(k)}
        aria-invalid={!!errs[k]}
        {...extra}
      />
      <p className="err">{MSG[k]}</p>
    </div>
  );

  const pay = () => {
    if (!check(["email", "cname", "cnum", "cexp", "ccvc"])) return;
    setBusy(true);
    setTimeout(() => { setBusy(false); setStep(4); }, 700);
  };
  const create = () => {
    if (!check(["apw"])) return;
    setOid("CR-" + Math.floor(10000 + Math.random() * 89999));
    setStep(5);
  };

  return (
    <>
      <header className="hero ord">
        <Clouds />
        <div className="wrap">
          <Nav cta={{ href: "/", label: "Back to home" }} />
          <div className="ohead">
            <h1>Order your video</h1>
            <p>Pick a style, share the details and pay once. Your finished video lands in your account in about 3 days.</p>
            <ol className="stepper" aria-label="Progress">
              {STEPS.map((s, i) => {
                const x = i + 1;
                return (
                  <li key={s} className={step >= 5 || x < step ? "done" : x === step ? "cur" : ""} aria-current={x === step ? "step" : undefined}>
                    <b>{x < step ? "✓" : x}</b>{s}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </header>

      <main className="wrap">
        <div className="olay">
          <div className="card">
            {step === 1 && (
              <section>
                <h2 tabIndex={-1} ref={head}>Choose a style</h2>
                <p className="lead">Every video is built in code, so it stays sharp at any size. You can change your style until you pay.</p>
                <div className="styles o">
                  {[
                    ["kinetic", "p1", <span key="a">Big <b>idea.</b></span>, "Bold words that move with the beat. Great for announcements."],
                    ["demo", "p2", <div className="ui" key="a"><i /><i /><i /><em /></div>, "Clean app walkthroughs with animated interface moments."],
                    ["data", "p3", <div className="bars" key="a"><i /><i /><i /><i /><i /></div>, "Charts and numbers that build up as you explain them."],
                    ["code", "p4", <><div>$ npm run build</div><div><em>✓</em> compiled</div><div><em>✓</em> rendered</div></>, "Terminal and editor scenes for developer-friendly content."],
                  ].map(([slug, cls, pv, text]) => (
                    <button key={slug} className="style" type="button" aria-pressed={style === slug} onClick={() => setStyle(slug)}>
                      <div className={"pv " + cls}>{pv}</div>
                      <h3>{STYLES[slug]}</h3>
                      <p>{text}</p>
                      <span className="tag" />
                    </button>
                  ))}
                </div>
                <div className="nav2">
                  <Link className="back" href="/#showcase">See examples again</Link>
                  <button className="btn lime" type="button" onClick={() => setStep(2)}>
                    Continue with <span>{STYLES[style]}</span> <span className="arr">→</span>
                  </button>
                </div>
              </section>
            )}

            {step === 2 && (
              <section>
                <h2 tabIndex={-1} ref={head}>Plan and details</h2>
                <p className="lead">Choose how many videos you need, then tell us what this one is for.</p>
                <div className="plans" role="radiogroup" aria-label="Plan">
                  {[
                    ["single", "One video up to 30 seconds. 2 edit rounds."],
                    ["pack", "Three videos up to 30 seconds each. Priority delivery."],
                    ["long", "One video up to 90 seconds. 3 edit rounds."],
                  ].map(([k, text]) => (
                    <label className="po" key={k}>
                      <input type="radio" name="plan" value={k} checked={plan === k} onChange={() => setPlan(k)} />
                      <b>{PLANS[k].name} <span>${PLANS[k].price}</span></b>
                      {text}
                      {k === "pack" && <em>Best value</em>}
                    </label>
                  ))}
                </div>
                {plan === "pack" && <p className="hint">This brief is for your first video. You’ll add the other two from your account.</p>}
                {field("goal", "What is the video for?", { placeholder: "e.g. Launch announcement for my app", autoComplete: "off" })}
                <div className="two">
                  <div className="field">
                    <label htmlFor="len">Length</label>
                    <select id="len" value={len} onChange={(e) => setLenSel(e.target.value)}>
                      {p.lens.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="col">Brand color</label>
                    <div className="col">
                      <input type="color" aria-label="Pick brand color" value={/^#[0-9a-f]{6}$/i.test(f.col) ? f.col : "#4a43e8"} onChange={(e) => set("col", e.target.value)} />
                      <input id="col" value={f.col} maxLength={7} autoComplete="off" onChange={(e) => set("col", e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="notes">Script or notes <span className="opt">(optional)</span></label>
                  <textarea id="notes" rows={3} value={f.notes} placeholder="Anything we should say or show?" onChange={(e) => set("notes", e.target.value)} />
                </div>
                <div className="nav2">
                  <button className="back" type="button" onClick={() => setStep(1)}>← Back</button>
                  <button className="btn lime" type="button" onClick={() => check(["goal"]) && setStep(3)}>Continue to payment <span className="arr">→</span></button>
                </div>
              </section>
            )}

            {step === 3 && (
              <section>
                <h2 tabIndex={-1} ref={head}>Pay once, securely</h2>
                <p className="lead">One flat price. We start as soon as the payment clears, and you create your account right after.</p>
                <p className="warn"><b>⚠ Prototype only.</b> No payment is taken and nothing is sent anywhere. Don’t enter real card details. A live version would use a hosted checkout from your payment provider.</p>
                {field("email", "Email for your receipt", { type: "email", inputMode: "email", autoComplete: "email", placeholder: "you@example.com" })}
                {field("cname", "Name on card", { autoComplete: "off", placeholder: "Full name" })}
                {field("cnum", "Card number", { inputMode: "numeric", autoComplete: "off", placeholder: "4242 4242 4242 4242" })}
                <div className="two">
                  {field("cexp", "Expiry", { inputMode: "numeric", autoComplete: "off", placeholder: "MM/YY", maxLength: 5 })}
                  {field("ccvc", "CVC", { inputMode: "numeric", autoComplete: "off", placeholder: "123", maxLength: 4 })}
                </div>
                <div className="nav2">
                  <button className="back" type="button" onClick={() => setStep(2)}>← Back</button>
                  <button className="btn lime" type="button" disabled={busy} onClick={pay}>
                    {busy ? "Processing…" : <>Pay ${p.price} <span className="arr">→</span></>}
                  </button>
                </div>
                <p className="lock">🔒 You’ll create your account right after paying.</p>
              </section>
            )}

            {step === 4 && (
              <section>
                <h2 tabIndex={-1} ref={head}>Payment received. Create your account</h2>
                <p className="lead">So your finished videos are waiting for you in one place.</p>
                <div className="field">
                  <label htmlFor="aemail">Email</label>
                  <input id="aemail" readOnly value={f.email} />
                </div>
                {field("apw", "Choose a password", { type: "password", autoComplete: "new-password", placeholder: "At least 8 characters" })}
                <div className="nav2">
                  <span />
                  <button className="btn lime" type="button" onClick={create}>Create account <span className="arr">→</span></button>
                </div>
              </section>
            )}

            {step === 5 && (
              <section>
                <div className="done-ico" aria-hidden="true">✓</div>
                <h2 tabIndex={-1} ref={head}>You’re all set</h2>
                <p className="lead">Order <b>{oid}</b> is in. Your first cut arrives in about 3 days, and you’ll find it in your account. {p.txt}</p>
                <div className="nav2"><Link className="btn dark" href="/">Back to home</Link><span /></div>
              </section>
            )}
          </div>

          <aside className="sum" aria-label="Your order">
            <h3>Your order</h3>
            <dl>
              <dt>Style</dt>
              <dd>{STYLES[style]}{step < 4 && <button className="lnk" type="button" onClick={() => setStep(1)}>Change</button>}</dd>
              <dt>Plan</dt><dd>{p.name}</dd>
              <dt>Length</dt><dd>{len}</dd>
              <dt>Edit rounds</dt><dd>{p.edits}</dd>
              <dt>First cut</dt><dd>About 3 days</dd>
            </dl>
            <div className="tot"><span>Total</span><b>${p.price}</b></div>
            <ul><li>Flat price, nothing else to pay</li><li>1080p MP4 in your account</li><li>No sales calls</li></ul>
          </aside>
        </div>

        <section className="faqmini">
          <h2>Questions before you order?</h2>
          <p>The answers are on the <Link href="/#faq">home page</Link>. There are no sales calls, so everything you need is there.</p>
        </section>
        <Footer />
      </main>
    </>
  );
}
