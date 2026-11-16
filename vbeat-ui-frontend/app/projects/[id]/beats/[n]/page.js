import Link from 'next/link';
import { notFound } from 'next/navigation';
import Rail from '@/components/Rail';
import Review from '@/components/Review';
import BeatList from '@/components/BeatList';
import { getProject, titleOf, lengthOf, counts } from '@/lib/data';

export async function generateMetadata({ params }) {
  const { id, n } = await params;
  const p = getProject(id);
  return { title: p ? `${titleOf(Number(n) - 1)} · ${p.name}` : 'Beat not found' };
}

const Arrow = ({ d }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

export default async function Beat({ params }) {
  const { id, n } = await params;
  const p = getProject(id);
  const i = Number(n) - 1;
  if (!p || !Number.isInteger(i) || i < 0 || i >= p.beats.length) notFound();
  const prev = i > 0 && `/projects/${id}/beats/${i}`;
  const next = i < p.beats.length - 1 && `/projects/${id}/beats/${i + 2}`;
  const c = counts(p.beats);
  return (
    <>
      <nav className="top" aria-label="Breadcrumb">
        <div>
          <Link href="/">Projects</Link> / <Link href={`/projects/${id}`}>{p.name}</Link> / <b aria-current="page">Beat {i + 1}</b>
        </div>
      </nav>
      <div className="head">
        <div>
          <h1>{titleOf(i)}</h1>
          <p className="sub">Beat {i + 1} of {p.beats.length}, {lengthOf(i).toFixed(1)} seconds</p>
        </div>
        <div className="nb">
          {prev ? <Link href={prev} className="ibtn" aria-label="Previous beat"><Arrow d="M15 5l-7 7 7 7" /></Link> : <span className="ibtn off" aria-hidden="true"><Arrow d="M15 5l-7 7 7 7" /></span>}
          {next ? <Link href={next} className="ibtn" aria-label="Next beat"><Arrow d="M9 5l7 7-7 7" /></Link> : <span className="ibtn off" aria-hidden="true"><Arrow d="M9 5l7 7-7 7" /></span>}
        </div>
      </div>
      <div className="railwrap">
        <Rail beats={p.beats} current={i} id={id} />
        <p className="railcap">{c.approved} of {p.beats.length} approved. Tap a segment to jump to that beat.</p>
      </div>
      <Review key={`${id}-${n}`} status={p.beats[i]} i={i} />
      <h2>Other beats in {p.name}</h2>
      <BeatList id={id} beats={p.beats} current={i} />
    </>
  );
}
