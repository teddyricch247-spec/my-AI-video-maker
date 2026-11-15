import Link from 'next/link';
import NewProjectForm from '@/components/NewProjectForm';

export const metadata = { title: 'New project' };

export default function NewProject() {
  return (
    <>
      <nav className="top" aria-label="Breadcrumb">
        <div><Link href="/">Projects</Link> / <b aria-current="page">New project</b></div>
      </nav>
      <h1>New project</h1>
      <p className="sub">Name it and pick a video format. You will add your transcript next.</p>
      <NewProjectForm />
    </>
  );
}
