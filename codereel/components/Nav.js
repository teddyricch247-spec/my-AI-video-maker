"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Logo from "./Logo";

const LINKS = [
  ["How it works", "/#how"],
  ["Examples", "/#showcase"],
  ["Pricing", "/#pricing"],
  ["FAQ", "/#faq"],
];

export default function Nav({ cta }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <nav ref={ref} className={"nav" + (open ? " open" : "")} aria-label="Main">
      <Logo />
      <ul id="menu">
        {LINKS.map(([label, href]) => (
          <li key={href}>
            <Link href={href} onClick={() => setOpen(false)}>{label}</Link>
          </li>
        ))}
      </ul>
      <div className="nav-r">
        <Link className="btn dark" href={cta.href}>
          <span className="full">{cta.label}</span>
          <span className="short">{cta.short || cta.label}</span>
        </Link>
        <button
          className="menu-btn"
          type="button"
          aria-expanded={open}
          aria-controls="menu"
          aria-label="Menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span />
        </button>
      </div>
    </nav>
  );
}
