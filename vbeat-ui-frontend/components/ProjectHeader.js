import Link from 'next/link';
import ProjectTabs from './ProjectTabs';

// Breadcrumb, title and section tabs. The same block sits on top of Setup, Plan, Beats and Export
// so the tabs stay in the same place when you switch between them.
export default function ProjectHeader({ p, tab }) {
  return (
    <>
      <nav className="top" aria-label="Breadcrumb">
        <div><Link href="/">Projects</Link> / <b aria-current="page">{p.name}</b></div>
      </nav>
      <h1>{p.name}</h1>
      <p className="sub">{p.words ? `${p.words} words, last edited ${p.when}` : 'Draft. Nothing uploaded yet.'}</p>
      <ProjectTabs id={p.id} tab={tab} />
    </>
  );
}
