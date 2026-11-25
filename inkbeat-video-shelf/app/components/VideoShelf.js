'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { groupVideosIntoFolders } from '../../lib/folders';

const VIDEO_MODES = [
  {
    id: '3d',
    label: 'Mode 1 · 3D Cartoon',
    skill: 'skill/inkbeat-shorts',
    summary: 'Toon-shaded 3D scenes, inverted-hull ink outlines, rigged characters & moving camera beats.',
    promptPrefix: 'Make a 9:16 video in Mode 1 (inkbeat-shorts — 3D Cartoon) from this transcript:',
  },
  {
    id: 'paper',
    label: 'Mode 2 · 2D Paper Motion',
    skill: 'skill/inkbeat-paper',
    summary: 'Warm flat-pastel 2D cutouts, 122 modular scenes & characters, 2D pan/zoom beats & live whiteboards.',
    promptPrefix: 'Make a 9:16 video in Mode 2 (inkbeat-paper — 2D Paper Motion) from this transcript:',
  },
];

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
    video.styleLabel,
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
  const [styleFilter, setStyleFilter] = useState('all'); // 'all' | '3d' | 'paper'
  const [copiedMode, setCopiedMode] = useState(null);
  const [query, setQuery] = useState('');
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const styleScopedVideos = useMemo(() => {
    if (styleFilter === 'all') return videos;
    return videos.filter((v) => (v.style || '3d') === styleFilter);
  }, [videos, styleFilter]);

  const allFolders = useMemo(() => groupVideosIntoFolders(videos), [videos]);
  const folders = useMemo(() => groupVideosIntoFolders(styleScopedVideos), [styleScopedVideos]);

  const activeFolder = useMemo(() => {
    if (!activeFolderSlug) return null;
    return (
      folders.find((f) => f.slug === activeFolderSlug) ||
      allFolders.find((f) => f.slug === activeFolderSlug) ||
      null
    );
  }, [folders, allFolders, activeFolderSlug]);

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
    if (!q) return styleScopedVideos;
    return styleScopedVideos.filter(
      (v) =>
        v.folderTitle.toLowerCase().includes(q) ||
        v.filename.toLowerCase().includes(q) ||
        v.partLabel.toLowerCase().includes(q)
    );
  }, [styleScopedVideos, query]);

  const totalBytes = useMemo(
    () => styleScopedVideos.reduce((sum, v) => sum + (typeof v.size === 'number' ? v.size : 0), 0),
    [styleScopedVideos]
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

  async function handleCopyPrompt(mode) {
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(mode.promptPrefix);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = mode.promptPrefix;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setErrorMsg('');
      setCopiedMode(mode.id);
      setTimeout(() => {
        setCopiedMode((cur) => (cur === mode.id ? null : cur));
      }, 2200);
    } else {
      setErrorMsg(`Copy unavailable automatically — use: ${mode.promptPrefix}`);
    }
  }

  function toggleStyleCard(id) {
    setStyleFilter((prev) => (prev === id ? 'all' : id));
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

  return (
    <div className="shelf-wrap">
      {!activeFolder && (
        <section className="mode-deck" aria-label="Video style modes">
          {VIDEO_MODES.map((m) => {
            const isSelected = styleFilter === m.id;
            const count = videos.filter((v) => (v.style || '3d') === m.id).length;
            return (
              <article
                key={m.id}
                className={isSelected ? 'mode-card active' : 'mode-card'}
              >
                <div className="mode-card-head">
                  <h2>{m.label}</h2>
                  <span className="meta nums">{count === 1 ? '1 clip' : `${count} clips`}</span>
                </div>
                <p className="mode-desc">{m.summary}</p>
                <div className="mode-actions">
                  <button
                    type="button"
                    className={isSelected ? 'mode-btn selected' : 'mode-btn'}
                    aria-pressed={isSelected}
                    onClick={() => toggleStyleCard(m.id)}
                  >
                    {isSelected ? 'Showing style' : `Filter ${m.id === '3d' ? '3D' : '2D'}`}
                  </button>
                  <button
                    type="button"
                    className="mode-btn ghost"
                    onClick={() => handleCopyPrompt(m)}
                  >
                    {copiedMode === m.id ? 'Copied prompt' : 'Copy prompt'}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {!activeFolder && videos.length > 0 && (
        <div className="toolbar">
          <div className="toolbar-summary nums">
            <span>{folders.length === 1 ? '1 folder' : `${folders.length} folders`}</span>
            <span aria-hidden="true">·</span>
            <span>{styleScopedVideos.length === 1 ? '1 video' : `${styleScopedVideos.length} videos`}</span>
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

            <div className="view-switch three" role="tablist" aria-label="Style filter">
              {[
                { id: 'all', label: 'All' },
                { id: '3d', label: '3D' },
                { id: 'paper', label: '2D Paper' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={styleFilter === s.id}
                  className={styleFilter === s.id ? 'switch-btn active' : 'switch-btn'}
                  onClick={() => setStyleFilter(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

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

      {videos.length === 0 ? (
        <section className="notice empty" aria-live="polite">
          <h2>No saved videos yet</h2>
          <p>
            Pick Mode 1 (3D Cartoon) or Mode 2 (2D Paper Motion) above and ask the agent to render a draft, then say save when ready.
          </p>
        </section>
      ) : activeFolder ? (
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
                activeFolder.styles?.map((s) => (s === 'paper' ? '2D Paper' : '3D Cartoon')).join(' + '),
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
      ) : styleScopedVideos.length === 0 ? (
        <section className="notice empty">
          <h2>No {styleFilter === 'paper' ? '2D Paper' : '3D Cartoon'} clips saved yet</h2>
          <p>
            Copy the prompt prefix from the {styleFilter === 'paper' ? 'Mode 2' : 'Mode 1'} card above to render in this style, or show all saved clips.
          </p>
          <p style={{ marginTop: '0.85rem' }}>
            <button type="button" className="back-btn" onClick={() => setStyleFilter('all')}>
              Show all styles
            </button>
          </p>
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
                        folder.styles?.map((s) => (s === 'paper' ? '2D Paper' : '3D')).join(' + '),
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
