import Hero from "@/components/Hero";
import Showcase from "@/components/Showcase";
import Footer from "@/components/Footer";
import { Bento, How, Faq, FinalCta } from "@/components/HomeSections";

export default function Home() {
  return (
    <>
      <Hero />
      <main className="wrap">
        <Bento />
        <Showcase />
        <How />
        <Faq />
        <FinalCta />
        <Footer />
      </main>
    </>
  );
}
