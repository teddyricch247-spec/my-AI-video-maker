import Link from 'next/link';
import { notFound } from 'next/navigation';
import Rail from '@/components/Rail';
import Stats from '@/components/Stats';
import BeatList from '@/components/BeatList';
import { getProject } from '@/lib/data';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: getProject(id)?.name ?? 'Project not found' };
}

export default async function Beats({ params }) {
  const { id } = await params;
  const p = getProject(id);
  if (!p) notFound();
  return (
    <>
      <nav className="top" aria-label="Breadcrumb">
        <div><Link href="/">Projects</Link> / <b aria-current="page">{p.name}</b></div>
      </nav>
      <h1>{p.name}</h1>
      <p className="sub">{p.words} words, last edited {p.when}</p>
      <Rail beats={p.beats} />
      <Stats p={p} />
      <h2 className="first">Beats</h2>
      <BeatList id={p.id} beats={p.beats} />
    </>
  );
}
