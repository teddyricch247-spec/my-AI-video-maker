import { notFound } from 'next/navigation';
import ProjectHeader from '@/components/ProjectHeader';
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
      <ProjectHeader p={p} tab="beats" />
      <Rail beats={p.beats} />
      <Stats p={p} />
      <h2 className="first">Beats</h2>
      <BeatList id={p.id} beats={p.beats} />
    </>
  );
}
