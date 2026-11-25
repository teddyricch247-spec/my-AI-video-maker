import { listVideos } from '../lib/supabase';
import VideoShelf from './components/VideoShelf';

// Always read the live Supabase bucket, never a cached copy.
export const dynamic = 'force-dynamic';

function Notice({ tone, title, children }) {
  return (
    <section className={`notice ${tone}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Problem({ problem, bucket, status }) {
  if (problem === 'not-connected') {
    return (
      <Notice tone="warn" title="Supabase isn’t connected yet">
        <p>Check config/shelf.json (url and publishableKey), then reload this page.</p>
      </Notice>
    );
  }
  if (problem === 'no-bucket') {
    return (
      <Notice tone="warn" title={`The “${bucket}” bucket doesn’t exist`}>
        <p>Run <code>supabase/setup.sql</code> in the Supabase SQL editor, then reload.</p>
      </Notice>
    );
  }
  if (problem === 'rejected') {
    return (
      <Notice tone="warn" title="Supabase refused the request">
        <p>It answered with status {status}. Check that the key in config/shelf.json belongs to this project.</p>
      </Notice>
    );
  }
  return (
    <Notice tone="warn" title="Couldn’t reach Supabase">
      <p>Check the url in config/shelf.json and your connection, then reload.</p>
    </Notice>
  );
}

export default async function Page({ searchParams }) {
  const [resolvedParams, { videos, problem, bucket, status }] = await Promise.all([
    Promise.resolve(searchParams),
    listVideos(),
  ]);

  const initialFolderSlug =
    typeof resolvedParams?.folder === 'string' && resolvedParams.folder.trim()
      ? resolvedParams.folder.trim().toLowerCase()
      : null;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Video shelf</h1>
        <p className="lede">
          Two video styles — 3D Cartoon and 2D Paper Motion. Pick a mode, browse session folders, play parts in order, or download saved clips.
        </p>
      </header>

      {problem ? (
        <Problem problem={problem} bucket={bucket} status={status} />
      ) : (
        <VideoShelf initialVideos={videos} initialFolderSlug={initialFolderSlug} />
      )}
    </main>
  );
}
