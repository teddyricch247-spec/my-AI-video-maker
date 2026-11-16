import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer>
      <Logo />
      <nav aria-label="Footer">
        <Link href="/">Home</Link>
        <Link href="/order">Order a video</Link>
      </nav>
      <span>Design prototype · placeholder content</span>
    </footer>
  );
}
