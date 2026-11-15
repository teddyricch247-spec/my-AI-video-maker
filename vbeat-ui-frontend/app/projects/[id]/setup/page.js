import ProjectHeader from '@/components/ProjectHeader';
import SetupView from '@/components/SetupView';
import { projectOr } from '@/lib/mock';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Setup · ${projectOr(id).name}` };
}

export default async function Setup({ params }) {
  const { id } = await params;
  const p = projectOr(id);
  return (
    <>
      <ProjectHeader p={p} tab="setup" />
      <SetupView id={p.id} words={p.words} />
    </>
  );
}
