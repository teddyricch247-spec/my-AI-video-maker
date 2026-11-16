'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const Icon = ({ d }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const GEAR = 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z';
const items = [
  { href: '/', label: 'Projects', d: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z', on: (p) => p === '/' || p.startsWith('/projects') },
  { href: '/costs', label: 'Costs', d: 'M5 20V10M12 20V4M19 20v-7', on: (p) => p.startsWith('/costs') },
  { href: '/settings', label: 'Settings', d: GEAR, on: (p) => p.startsWith('/settings') || p.startsWith('/ops') },
];

export default function Shell({ children }) {
  const path = usePathname();

  // The login screen has no navigation: nobody to navigate for yet.
  if (path === '/login') {
    return (
      <main className="auth" id="main">{children}</main>
    );
  }

  return (
    <div className="app">
      <a href="#main" className="skip">Skip to content</a>
      <nav className="side" aria-label="Main">
        <Link href="/" className="brand"><i aria-hidden="true">▶</i>vbeat</Link>
        {items.map((i) => {
          const on = i.on(path);
          return (
            <Link key={i.href} href={i.href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
              <Icon d={i.d} />{i.label}
            </Link>
          );
        })}
        <div className="me"><i aria-hidden="true">RM</i>Response M.</div>
      </nav>
      <main className="main" id="main">{children}</main>
    </div>
  );
}
