import ProjectHeader from '@/components/ProjectHeader';
import ExportView from '@/components/ExportView';
import { projectOr, exportsFor } from '@/lib/mock';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Export · ${projectOr(id).name}` };
}

export default async function Export({ params }) {
  const { id } = await params;
  const p = projectOr(id);
  return (
    <>
      <ProjectHeader p={p} tab="export" />
      <ExportView beats={p.beats} initial={exportsFor(p.beats)} />
    </>
  );
}
