import Link from 'next/link';
import Rail from '@/components/Rail';
import Chip from '@/components/Chip';
import { projects, counts } from '@/lib/data';
import { flagOf, needsYou, byUrgency } from '@/lib/mock';

export default function Projects() {
  // Projects that need you come first, so there is no need for a separate "waiting" banner.
  const list = [...projects].sort(byUrgency);
  const waiting = projects.filter((p) => needsYou(p.beats)).length;
  return (
    <>
      <div className="head">
        <div>
          <h1>Projects</h1>
          <p className="sub">{waiting ? `${waiting} ${waiting === 1 ? 'project needs' : 'projects need'} your attention.` : 'All caught up.'}</p>
        </div>
        <Link href="/projects/new" className="btn pri">New project</Link>
      </div>
      <ul className="plist">
        {list.map((p) => {
          const c = counts(p.beats);
          const flag = flagOf(p.beats) ?? (c.approved === p.beats.length ? 'approved' : null);
          return (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="card proj">
                <span className="ptop"><b>{p.name}</b><small>{p.when}</small></span>
                <Rail beats={p.beats} />
                <span className="pmeta">
                  <span className="pm">
                    <b>{c.approved} of {p.beats.length} beats approved</b>
                    <small>{p.words} words · ${p.spent.toFixed(2)} spent</small>
                  </span>
                  {flag && <Chip status={flag} />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
