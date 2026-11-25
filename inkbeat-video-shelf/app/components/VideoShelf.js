'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupVideosIntoFolders } from '../../lib/folders';

function megabytes(bytes) {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '';
}

function day(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function summarizeParts(videos) {
  if (!videos.length) return '';
  const labels = videos.map((v) => v.partLabel);
  if (labels.length <= 4) return labels.join(' · ');
  return `${labels.slice(0, 3).join(' · ')} · +${labels.length - 3} more`;
}

function VideoCard({ video, folderTitle, showFolderName, onDeleted, onError }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (deleting) return;
    setDeleting(true);
    onError('');

    try {
      const res = await fetch('/api/videos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [video.name] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setDeleting(false);
        setConfirming(false);
        onError(data.error || `Could not delete ${video.filename} (status ${res.status}).`);
        return;
      }
      onDeleted([video.name]);
    } catch {
      setDeleting(false);
      setConfirming(false);
      onError(`Network error while deleting ${video.filename}.`);
    }
  }

  const metaParts = [
    showFolderName ? folderTitle : null,
    video.wide ? '16:9' : null,
    megabytes(video.size),
    day(video.created),
  ].filter(Boolean);

  return (
    <li className={video.wide ? 'clip wide' : 'clip'}>
      <video
        src={`${video.src}#t=0.1`}
        aria-label={`${folderTitle} ${video.partLabel}`}
        controls
        playsInline
        preload="metadata"
      />
      <div className="clip-body">
        <h3>{video.partLabel}</h3>
        <p className="meta nums">{metaParts.join(' · ')}</p>
        <p className="meta filename">{video.filename}</p>
      </div>

      {!confirming ? (
        <div className="clip-actions">
          <a className="clip-btn download" href={video.download} download={video.filename}>
            Download
          </a>
          <button
            type="button"
            className="clip-btn delete"
            aria-label={`Delete ${video.filename}`}
            disabled={deleting}
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        </div>
      ) : (
        <div className="clip-actions confirm" role="group" aria-label={`Confirm deleting ${video.filename}`}>
          <button
            type="button"
            className="clip-btn confirm-delete"
            aria-label={`Confirm delete ${video.filename}`}
            disabled={deleting}
            onClick={handleConfirmDelete}
          >
            {deleting ? 'Deleting…' : 'Confirm delete'}
          </button>
          <button
            type="button"
            className="clip-btn cancel"
            aria-label={`Cancel deleting ${video.filename}`}
            disabled={deleting}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

export default function VideoShelf({ initialVideos, initialFolderSlug = null }) {
  const router = useRouter();
  const [videos, setVideos] = useState(initialVideos || []);
  const [activeFolderSlug, setActiveFolderSlug] = useState(initialFolderSlug);
  const [viewMode, setViewMode] = useState('folders'); // 'folders' | 'all'
  const [query, setQuery] = useState('');
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const folders = useMemo(() => groupVideosIntoFolders(videos), [videos]);

  const activeFolder = useMemo(
    () => (activeFolderSlug ? folders.find((f) => f.slug === activeFolderSlug) || null : null),
    [folders, activeFolderSlug]
  );

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.slug.toLowerCase().includes(q) ||
        f.videos.some((v) => v.filename.toLowerCase().includes(q))
    );
  }, [folders, query]);

  const filteredVideos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) =>
        v.folderTitle.toLowerCase().includes(q) ||
        v.filename.toLowerCase().includes(q) ||
        v.partLabel.toLowerCase().includes(q)
    );
  }, [videos, query]);

  const totalBytes = useMemo(
    () => videos.reduce((sum, v) => sum + (typeof v.size === 'number' ? v.size : 0), 0),
    [videos]
  );

  function syncFolderUrl(slug) {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (slug) {
      url.searchParams.set('folder', slug);
    } else {
      url.searchParams.delete('folder');
    }
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  function openFolder(slug) {
    setErrorMsg('');
    setConfirmDeleteFolder(false);
    setActiveFolderSlug(slug);
    setViewMode('folders');
    syncFolderUrl(slug);
  }

  function closeFolder() {
    setErrorMsg('');
    setConfirmDeleteFolder(false);
    setActiveFolderSlug(null);
    syncFolderUrl(null);
  }

  function handleVideosDeleted(deletedNames) {
    const removed = new Set(deletedNames);
    setVideos((prev) => {
      const next = prev.filter((v) => !removed.has(v.name));
      if (activeFolderSlug) {
        const nextFolders = groupVideosIntoFolders(next);
        if (!nextFolders.some((f) => f.slug === activeFolderSlug)) {
          setActiveFolderSlug(null);
          syncFolderUrl(null);
        }
      }
      return next;
    });
    setConfirmDeleteFolder(false);
    router.refresh();
  }

  async function handleDeleteFolder(folder) {
    if (deletingFolder || !folder.videos.length) return;
    setDeletingFolder(true);
    setErrorMsg('');

    const names = folder.videos.map((v) => v.name);
    try {
      const res = await fetch('/api/videos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setDeletingFolder(false);
        setConfirmDeleteFolder(false);
        setErrorMsg(data.error || `Could not delete folder "${folder.title}".`);
        return;
      }
      setDeletingFolder(false);
      handleVideosDeleted(names);
    } catch {
      setDeletingFolder(false);
      setConfirmDeleteFolder(false);
      setErrorMsg(`Network error while deleting folder "${folder.title}".`);
    }
  }

  if (videos.length === 0) {
    return (
      <section className="notice empty" aria-live="polite">
        <h2>No saved videos yet</h2>
        <p>Ask the agent to render and save a video to the database. Session folders will appear here automatically.</p>
      </section>
    );
  }

  return (
    <div className="shelf-wrap">
      {!activeFolder && (
        <div className="toolbar">
          <div className="toolbar-summary nums">
            <span>{folders.length === 1 ? '1 folder' : `${folders.length} folders`}</span>
            <span aria-hidden="true">·</span>
            <span>{videos.length === 1 ? '1 video' : `${videos.length} videos`}</span>
            {totalBytes > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{megabytes(totalBytes)}</span>
              </>
            )}
          </div>

          <div className="toolbar-controls">
            <label className="search-field">
              <span className="sr-only">Filter folders or videos</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sessions…"
                aria-label="Search sessions"
              />
            </label>

            <div className="view-switch" role="tablist" aria-label="Shelf view">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'folders'}
                className={viewMode === 'folders' ? 'switch-btn active' : 'switch-btn'}
                onClick={() => setViewMode('folders')}
              >
                Folders
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'all'}
                className={viewMode === 'all' ? 'switch-btn active' : 'switch-btn'}
                onClick={() => setViewMode('all')}
              >
                All clips
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="inline-notice warn" role="alert">
          <strong>Action failed:</strong> {errorMsg}
        </div>
      )}

      {activeFolder ? (
        <section className="folder-view" aria-labelledby="folder-heading">
          <div className="folder-bar">
            <button type="button" className="back-btn" onClick={closeFolder}>
              ← All folders
            </button>

            <div className="folder-bar-actions">
              {!confirmDeleteFolder ? (
                <button
                  type="button"
                  className="btn-delete-outline"
                  disabled={deletingFolder}
                  onClick={() => setConfirmDeleteFolder(true)}
                >
                  Delete folder
                </button>
              ) : (
                <div className="confirm-pair" role="group" aria-label={`Confirm deleting folder ${activeFolder.title}`}>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={deletingFolder}
                    onClick={() => handleDeleteFolder(activeFolder)}
                  >
                    {deletingFolder
                      ? 'Deleting…'
                      : `Confirm delete (${activeFolder.clipCount})`}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={deletingFolder}
                    onClick={() => setConfirmDeleteFolder(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="folder-header">
            <h2 id="folder-heading">{activeFolder.title}</h2>
            <p className="meta nums">
              {[
                activeFolder.clipCount === 1 ? '1 part' : `${activeFolder.clipCount} parts`,
                activeFolder.aspects.join(' / '),
                megabytes(activeFolder.totalBytes),
                day(activeFolder.latestCreated),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          <ul className="grid">
            {activeFolder.videos.map((v) => (
              <VideoCard
                key={v.name}
                video={v}
                folderTitle={activeFolder.title}
                showFolderName={false}
                onDeleted={handleVideosDeleted}
                onError={setErrorMsg}
              />
            ))}
          </ul>
        </section>
      ) : viewMode === 'folders' ? (
        filteredFolders.length === 0 ? (
          <section className="notice empty">
            <h2>No matching folders</h2>
            <p>Nothing matched “{query}”. Clear your search to see all {folders.length} session folders.</p>
          </section>
        ) : (
          <ul className="folder-grid" aria-label="Session folders">
            {filteredFolders.map((folder) => (
              <li className="folder-item" key={folder.slug}>
                <div className="folder-tab" aria-hidden="true">
                  <span className="nums">{folder.clipCount === 1 ? '1 clip' : `${folder.clipCount} clips`}</span>
                </div>
                <article className="folder-card">
                  <div className="folder-card-top">
                    <h2>{folder.title}</h2>
                    <p className="meta nums">
                      {[
                        folder.aspects.join(' / '),
                        megabytes(folder.totalBytes),
                        day(folder.latestCreated),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <p className="folder-parts nums">{summarizeParts(folder.videos)}</p>

                  <button
                    type="button"
                    className="folder-open-btn"
                    aria-label={`Open ${folder.title} folder (${folder.clipCount} ${folder.clipCount === 1 ? 'clip' : 'clips'})`}
                    onClick={() => openFolder(folder.slug)}
                  >
                    Open folder
                  </button>
                </article>
              </li>
            ))}
          </ul>
        )
      ) : filteredVideos.length === 0 ? (
        <section className="notice empty">
          <h2>No matching clips</h2>
          <p>Nothing matched “{query}”.</p>
        </section>
      ) : (
        <ul className="grid">
          {filteredVideos.map((v) => (
            <VideoCard
              key={v.name}
              video={v}
              folderTitle={v.folderTitle}
              showFolderName={true}
              onDeleted={handleVideosDeleted}
              onError={setErrorMsg}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
