import Link from "next/link";
import Clouds from "./Clouds";

export function Bento() {
  return (
<section style={{"paddingTop":"56px"}} aria-label="At a glance">
  <div className="bento">
   <div className="tile"><p>Typical turnaround</p><div><div className="n">3 days</div><p>from payment to first cut</p></div></div>
   <div className="tile l"><p>Edit rounds included</p><div><div className="n">2</div><p>tweak text, timing and colors</p></div></div>
   <div className="tile d"><h3>Pick. Brief. Pay.<br />That’s the whole process.</h3><p>No sales calls, no back-and-forth to get a quote.</p></div>
   <div className="tile b"><p>Plans from</p><div><div className="n">$149</div><p>per finished video</p></div></div>
  </div>
 </section>
  );
}

export function How() {
  return (
<section id="how">
  <div className="head"><h2>How it works</h2><p>Four steps, and you never touch the code.</p></div>
  <ol className="how">
   <li><span>1</span><div><b>Pick a style and tell us what you need</b><p>Fill in a short brief: goal, length, script or notes, brand colors.</p></div></li>
   <li><span>2</span><div><b>Pay once, securely</b><p>One flat price. We start as soon as the payment clears.</p></div></li>
   <li><span>3</span><div><b>Create your account</b><p>So every video you order stays in one place.</p></div></li>
   <li><span>4</span><div><b>Review and download</b><p>Request up to two rounds of edits, then download the MP4.</p></div></li>
  </ol>
 </section>
  );
}

export function Pricing() {
  return (
<section id="pricing">
  <div className="head"><h2>Pick a plan, pay once</h2><p>Prices are placeholders for this prototype.</p></div>
  <div className="price">
   <div className="plan"><h3>Single</h3><div className="amt">$149</div><ul><li>One video up to 30 seconds</li><li>Any style</li><li>2 edit rounds</li></ul><Link className="btn dark" href="/order?plan=single">Choose Single</Link></div>
   <div className="plan hot"><h3>Pack of 3</h3><div className="amt">$399</div><ul><li>Three videos up to 30 seconds</li><li>Mix styles freely</li><li>Priority delivery</li><li>2 edit rounds each</li></ul><Link className="btn lime" href="/order?plan=pack">Choose Pack of 3</Link></div>
   <div className="plan"><h3>Long form</h3><div className="amt">$299</div><ul><li>One video up to 90 seconds</li><li>Any style</li><li>3 edit rounds</li></ul><Link className="btn dark" href="/order?plan=long">Choose Long form</Link></div>
  </div>
 </section>
  );
}

export function Faq() {
  return (
<section id="faq">
  <div className="head"><h2>Good to know</h2></div>
  <div className="faq">
   <details><summary>Do I need to know how to code?</summary><p>No. You send the brief and we handle everything else.</p></details>
   <details><summary>What do I get?</summary><p>A 1080p MP4 in your account, ready for social, your site or ads.</p></details>
   <details><summary>How do edits work?</summary><p>Reply inside your account with what to change. Each plan includes edit rounds.</p></details>
   <details><summary>Can I order more later?</summary><p>Yes. Your account keeps every video and brief for easy reorders.</p></details>
   <details><summary>How long does it take?</summary><p>Most first cuts arrive about 3 days after payment. Pack of 3 orders get priority.</p></details>
   <details><summary>Do I need to talk to anyone first?</summary><p>No. There are no sales calls. Pick a style, fill in the brief and pay.</p></details>
  </div>
 </section>
  );
}

export function FinalCta() {
  return (
<section aria-label="Order now">
  <div className="cta">
   <Clouds soft />
   <div><h2>Ready to see your idea move?</h2><div className="cta-row" style={{"marginTop":"22px"}}><Link className="btn dark" href="/order">Choose your style <span className="arr" style={{"background":"var(--lime)","color":"var(--ink)"}}>→</span></Link></div></div>
   <div className="knot" aria-hidden="true"></div>
  </div>
 </section>
  );
}

