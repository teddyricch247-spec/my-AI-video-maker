import Link from 'next/link';
import Rail from '@/components/Rail';
import Chip from '@/components/Chip';
import { projects, titleOf, counts } from '@/lib/data';

export default function Projects() {
  const hero = projects.find((p) => p.beats.includes('review')) ?? projects[0];
  const next = Math.max(0, hero.beats.indexOf('review'));
  return (
    <>
      <h1>Projects</h1>
      <p className="sub">Pick up where you left off.</p>
      <Link href={`/projects/${hero.id}/beats/${next + 1}`} className="card hero">
        <span className="chip pri">Waiting for you</span>
        <b>Beat {next + 1} of {hero.beats.length} in {hero.name} is ready</b>
        <span>{titleOf(next)}. Play it, then approve it or ask for changes.</span>
      </Link>
      <h2>All projects</h2>
      <ul className="plist">
        {projects.map((p) => {
          const c = counts(p.beats);
          return (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="card proj">
                <span className="ptop"><b>{p.name}</b><small>{p.when}</small></span>
                <Rail beats={p.beats} />
                <span className="pmeta">
                  <small>{c.approved} of {p.beats.length} beats approved, {p.words} words, ${p.spent.toFixed(2)} spent</small>
                  {c.review > 0 && <Chip status="review" />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
