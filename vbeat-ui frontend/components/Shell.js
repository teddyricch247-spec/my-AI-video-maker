'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const Icon = ({ d }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const items = [
  { href: '/', label: 'Projects', d: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
  { href: '/costs', label: 'Costs', d: 'M5 20V10M12 20V4M19 20v-7' },
];

export default function Shell({ children }) {
  const path = usePathname();
  const on = (h) => (h === '/' ? path === '/' || path.startsWith('/projects') : path.startsWith(h));
  return (
    <div className="app">
      <a href="#main" className="skip">Skip to content</a>
      <nav className="side" aria-label="Main">
        <Link href="/" className="brand"><i aria-hidden="true">▶</i>vbeat</Link>
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={on(i.href) ? 'on' : ''} aria-current={on(i.href) ? 'page' : undefined}>
            <Icon d={i.d} />{i.label}
          </Link>
        ))}
        <div className="me"><i aria-hidden="true">RM</i>Response M.</div>
      </nav>
      <main className="main" id="main">{children}</main>
    </div>
  );
}
