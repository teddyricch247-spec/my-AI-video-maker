import { listVideos } from '../lib/supabase';

// Always read the live bucket, never a cached copy.
export const dynamic = 'force-dynamic';

function megabytes(bytes) {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '';
}

function day(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

export default async function Page() {
  const { videos, problem, bucket, status } = await listVideos();

  return (
    <main className="page">
      <header>
        <h1>Shorts shelf</h1>
        <p className="lede">Tap a clip to play it. Download saves the file to your phone. Wide clips are 16:9 for YouTube.</p>
        {!problem && (
          <p className="count">{videos.length === 1 ? '1 clip' : `${videos.length} clips`}</p>
        )}
      </header>

      {problem && <Problem problem={problem} bucket={bucket} status={status} />}

      {!problem && videos.length === 0 && (
        <Notice tone="empty" title="No clips yet">
          <p>Ask the agent to render a Short and upload it. It shows up here on the next reload.</p>
        </Notice>
      )}

      {videos.length > 0 && (
        <ul className="grid">
          {videos.map((v) => (
            <li className={v.wide ? 'clip wide' : 'clip'} key={v.name}>
              <video src={`${v.src}#t=0.1`} aria-label={v.title} controls playsInline preload="metadata" />
              <h2>{v.title}</h2>
              <p className="meta">{[megabytes(v.size), day(v.created)].filter(Boolean).join(', ')}</p>
              <a className="save" href={v.download}>Download</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
