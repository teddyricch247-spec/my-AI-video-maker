import Hero from "@/components/Hero";
import Showcase from "@/components/Showcase";
import Footer from "@/components/Footer";
import { Bento, How, Pricing, Faq, FinalCta } from "@/components/HomeSections";

export default function Home() {
  return (
    <>
      <Hero />
      <main className="wrap">
        <Bento />
        <How />
        <Showcase />
        <Pricing />
        <Faq />
        <FinalCta />
        <Footer />
      </main>
    </>
  );
}
