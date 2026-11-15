import Link from 'next/link';

// [key, label, path segment]. "Beats" is the project overview page itself.
const TABS = [
  ['setup', 'Setup', 'setup'],
  ['plan', 'Plan', 'plan'],
  ['beats', 'Beats', ''],
  ['export', 'Export', 'export'],
];

export default function ProjectTabs({ id, tab }) {
  return (
    <nav className="ptabs" aria-label="Project sections">
      {TABS.map(([k, label, seg]) => (
        <Link key={k} href={`/projects/${id}${seg ? `/${seg}` : ''}`} aria-current={tab === k ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
