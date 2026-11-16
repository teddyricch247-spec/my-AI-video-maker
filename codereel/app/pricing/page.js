import Link from "next/link";
import Clouds from "@/components/Clouds";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PricingPlans from "@/components/PricingPlans";
import { FinalCta } from "@/components/HomeSections";

export const metadata = {
  title: "Pricing – Codereel",
  description: "One flat price per video. Pick a plan, pay once, and your finished video lands in your account.",
};

const INCLUDED = [
  ["1080p MP4", "Yours to keep, ready for social, your site or ads."],
  ["Built in code", "Sharp at any size, easy to tweak and reorder."],
  ["Your own account", "Every video and brief stays in one place."],
  ["No sales calls", "Pick a style, fill in the brief and pay."],
];

export default function PricingPage() {
  return (
    <>
      <header className="hero ord">
        <Clouds />
        <div className="wrap">
          <Nav cta={{ href: "/order", label: "Start your video", short: "Order" }} />
          <div className="ohead">
            <h1>Pick a plan, pay once</h1>
            <p>Prices are placeholders for this prototype.</p>
          </div>
        </div>
      </header>

      <main className="wrap">
        <section style={{ paddingTop: "48px" }} aria-label="Plans">
          <PricingPlans />
        </section>

        <section aria-label="What every plan includes">
          <div className="head"><h2>Every plan includes</h2></div>
          <ul className="incl">
            {INCLUDED.map(([t, d]) => (
              <li key={t}><b>{t}</b><p>{d}</p></li>
            ))}
          </ul>
        </section>

        <section className="faqmini" style={{ paddingTop: "64px" }}>
          <h2>Questions before you order?</h2>
          <p>The answers are on the <Link href="/#faq">home page</Link>. There are no sales calls, so everything you need is there.</p>
        </section>

        <FinalCta />
        <Footer />
      </main>
    </>
  );
}
