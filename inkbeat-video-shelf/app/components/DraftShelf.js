'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function buildMetaParts(draft) {
  const items = [draft.aspect, draft.mode];
  if (draft.seconds != null) items.push(`${draft.seconds}s`);
  if (draft.sPerFrame != null) items.push(`${draft.sPerFrame} s/frame`);
  if (draft.parts.length > 0) {
    items.push(draft.parts.length === 1 ? '1 part' : `${draft.parts.length} parts`);
    items.push(`${draft.totalMb.toFixed(1)} MB`);
  }
  items.push(draft.uploaded ? 'Saved copy on shelf' : 'Local preview only');
  return items;
}

function DraftCard({ draft, onDiscarded }) {
  const router = useRouter();
  const [saveName, setSaveName] = useState(draft.slug);
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [showSheets, setShowSheets] = useState(false);
  const [savedFiles, setSavedFiles] = useState(draft.uploadedFiles || []);
  const [errorMsg, setErrorMsg] = useState('');

  const metaItems = buildMetaParts({ ...draft, uploaded: draft.uploaded || status === 'saved' });

  async function handleSave(e) {
    e.preventDefault();
    if (status === 'saving' || draft.parts.length === 0) return;
    setStatus('saving');
    setErrorMsg('');

    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draft.slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim() || draft.slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus('error');
        setErrorMsg(data.error || `Upload failed with status ${res.status}.`);
        return;
      }
      setStatus('saved');
      setSavedFiles(data.files || []);
      router.refresh();
    } catch {
      setStatus('error');
      setErrorMsg('Network error while saving to the shelf.');
    }
  }

  async function handleDiscard() {
    if (discarding) return;
    setDiscarding(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draft.slug)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDiscarding(false);
        setConfirmDiscard(false);
        setErrorMsg(data.error || 'Could not discard draft.');
        return;
      }
      onDiscarded(draft.slug);
      router.refresh();
    } catch {
      setDiscarding(false);
      setConfirmDiscard(false);
      setErrorMsg('Network error while discarding draft.');
    }
  }

  return (
    <article className="draft-card">
      <div className="draft-head">
        <h3>{draft.title}</h3>
        <p className="meta nums">{metaItems.join(' · ')}</p>
      </div>

      {draft.parts.length > 0 && (
        <ul className="grid draft-grid">
          {draft.parts.map((part) => (
            <li className={draft.wide ? 'clip wide' : 'clip'} key={part.file}>
              <video
                src={`${part.src}#t=0.1`}
                aria-label={`${draft.title} part ${part.index}`}
                controls
                playsInline
                preload="metadata"
              />
              <h4 className="part-title">
                {draft.parts.length === 1 ? 'Full clip' : `Part ${part.index}`}
              </h4>
              <p className="meta nums">
                {[part.seconds != null ? `${part.seconds}s` : null, `${part.mb.toFixed(1)} MB`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <a className="save secondary" href={part.download}>
                Download
              </a>
            </li>
          ))}
        </ul>
      )}

      {draft.sheets.length > 0 && (
        <div className="sheets-block">
          <button
            type="button"
            className="text-toggle"
            aria-expanded={showSheets}
            onClick={() => setShowSheets((prev) => !prev)}
          >
            {showSheets
              ? `Hide contact ${draft.sheets.length === 1 ? 'sheet' : 'sheets'}`
              : `Inspect contact ${draft.sheets.length === 1 ? 'sheet' : `sheets (${draft.sheets.length})`}`}
          </button>
          {showSheets && (
            <div className="sheets-grid">
              {draft.sheets.map((sheet) => (
                <figure className="sheet-item" key={sheet.file}>
                  <img
                    src={`${sheet.src}?v=${Math.round(sheet.mtimeMs || 0)}`}
                    alt={`${draft.title} ${sheet.label}`}
                    loading="lazy"
                  />
                  <figcaption className="meta">{sheet.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      )}

      <form className="draft-actions" onSubmit={handleSave}>
        {draft.parts.length > 0 && (
          <label className="name-field">
            <span className="field-label">Shelf name</span>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={draft.slug}
              disabled={status === 'saving'}
              aria-label="Shelf filename"
            />
          </label>
        )}

        <div className="action-buttons">
          {draft.parts.length > 0 && (
            <button type="submit" className="btn-primary" disabled={status === 'saving'}>
              {status === 'saving'
                ? 'Saving to shelf…'
                : draft.uploaded || status === 'saved'
                  ? 'Update on shelf'
                  : 'Save to shelf'}
            </button>
          )}

          {!confirmDiscard ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={status === 'saving' || discarding}
              onClick={() => setConfirmDiscard(true)}
            >
              Discard
            </button>
          ) : (
            <div className="confirm-pair">
              <button
                type="button"
                className="btn-danger"
                disabled={discarding}
                onClick={handleDiscard}
              >
                {discarding ? 'Discarding…' : 'Confirm discard'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={discarding}
                onClick={() => setConfirmDiscard(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </form>

      {errorMsg && (
        <div className="inline-notice warn" role="alert">
          <strong>Save error:</strong> {errorMsg}
        </div>
      )}

      {savedFiles.length > 0 && (status === 'saved' || draft.uploaded) && (
        <div className="inline-notice ok">
          <strong>{status === 'saved' ? 'Saved to shelf:' : 'Watch links:'}</strong>
          <ul className="watch-list">
            {savedFiles.map((f) => (
              <li key={f.name}>
                <a href={f.watchUrl} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
                <span className="meta nums"> · {f.mb.toFixed(1)} MB</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default function DraftShelf({ initialDrafts }) {
  const [drafts, setDrafts] = useState(initialDrafts);

  function handleDiscarded(slug) {
    setDrafts((prev) => prev.filter((d) => d.slug !== slug));
  }

  if (!drafts.length) return null;

  return (
    <section className="draft-section" id="drafts" aria-labelledby="drafts-heading">
      <div className="section-head">
        <h2 id="drafts-heading">Draft previews</h2>
        <p className="meta nums">
          {drafts.length === 1 ? '1 local draft' : `${drafts.length} local drafts`} · Ready to review before saving to Supabase
        </p>
      </div>
      <div className="draft-list">
        {drafts.map((draft) => (
          <DraftCard key={draft.slug} draft={draft} onDiscarded={handleDiscarded} />
        ))}
      </div>
    </section>
  );
}
