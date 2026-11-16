import Link from "next/link";
import Clouds from "./Clouds";
import Nav from "./Nav";
import HeroStage from "./HeroStage";

export default function Hero() {
  return (
    <header className="hero">
      <Clouds />
      <div className="wrap">
        <Nav cta={{ href: "/order", label: "Start your video", short: "Order" }} />
        <div className="hero-in">
          <div>
            <h1>
              Videos built in code. <span>Made for you.</span>
            </h1>
            <p className="sub">
              Skip the prompting and the re-renders. Pick a style, tell us what you need, and your
              finished video lands in your account.
            </p>
            <div className="cta-row">
              <Link className="btn lime" href="/order">
                Choose your style <span className="arr">→</span>
              </Link>
              <Link className="btn ghost" href="/#showcase">See examples</Link>
            </div>
          </div>
          <HeroStage />
        </div>
      </div>
    </header>
  );
}
