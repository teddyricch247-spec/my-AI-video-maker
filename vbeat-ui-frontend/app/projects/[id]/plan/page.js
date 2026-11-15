import ProjectHeader from '@/components/ProjectHeader';
import PlanView from '@/components/PlanView';
import { projectOr } from '@/lib/mock';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Plan · ${projectOr(id).name}` };
}

export default async function Plan({ params }) {
  const { id } = await params;
  const p = projectOr(id);
  return (
    <>
      <ProjectHeader p={p} tab="plan" />
      <PlanView id={p.id} beats={p.beats} words={p.words} />
    </>
  );
}
