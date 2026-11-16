import Link from 'next/link';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <section className="card pad stack notfound">
      <span className="chip gray" style={{ alignSelf: 'flex-start' }}>404</span>
      <h1>We could not find that page</h1>
      <p className="muted">The project or beat may have been removed, or the link has a typo.</p>
      <div className="rowf"><Link href="/" className="btn pri">Back to projects</Link></div>
    </section>
  );
}
