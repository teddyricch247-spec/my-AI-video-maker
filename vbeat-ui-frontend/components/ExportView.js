'use client';
import { useState } from 'react';
import Icon from './Icon';
import Chip from './Chip';
import StatePreview from './StatePreview';
import { titleOf, lengthOf } from '@/lib/data';
import { exportable, fileName, fileSize, fileMb } from '@/lib/mock';

const EXP = {
  queued: ['Waiting', 'gray'],
  running: ['Building', 'warn'],
  done: ['Ready', 'ok'],
  failed: ['Failed', 'bad'],
  expired: ['Expired', 'gray'],
};

export default function ExportView({ beats, initial }) {
  const [view, setView] = useState('list'); // list | empty
  const [list, setList] = useState(initial);
  const [sel, setSel] = useState(() => new Set(beats.flatMap((s, i) => (s === 'approved' ? [i] : []))));

  const ok = beats.flatMap((s, i) => (exportable(s) ? [i] : []));
  const n = ok.filter((i) => sel.has(i)).length;
  const shown = view === 'empty' ? [] : list;

  const toggle = (i) => setSel((s) => {
    const x = new Set(s);
    if (x.has(i)) x.delete(i); else x.add(i);
    return x;
  });
  const toggleAll = () => setSel(n === ok.length ? new Set() : new Set(ok));

  // Prototype: adds a "waiting" export card. Nothing is built.
  const start = () => {
    const picked = ok.filter((i) => sel.has(i));
    setList((l) => [{ id: `new-${Date.now()}`, status: 'queued', when: 'Just now', progress: [0, picked.length], files: [] }, ...l]);
    setView('list');
  };

  return (
    <div className="sect">
      <StatePreview
        options={[['list', 'Has exports'], ['empty', 'No exports']]}
        value={view}
        onChange={setView}
      />

      <div className="stack">
        <section className="card pad stack" aria-labelledby="h-pick">
          <div>
            <h2 className="ttl" id="h-pick">Beats to export</h2>
            <p className="hint">One MP4 per beat, with sound effects baked in, plus a manifest.</p>
          </div>

          {beats.length ? (
            <>
              <ul>
                <li>
                  <label className="chkrow all">
                    <input
                      type="checkbox"
                      checked={ok.length > 0 && n === ok.length}
                      ref={(el) => { if (el) el.indeterminate = n > 0 && n < ok.length; }}
                      onChange={toggleAll}
                      disabled={!ok.length}
                    />
                    <span className="t"><b>Select all</b></span>
                    <span className="hint">{n} of {beats.length} beats selected</span>
                  </label>
                </li>
                {beats.map((s, i) => {
                  const can = exportable(s);
                  return (
                    <li key={i}>
                      <label className={`chkrow${can ? '' : ' dis'}`}>
                        <input type="checkbox" checked={can && sel.has(i)} disabled={!can} onChange={() => toggle(i)} />
                        <span className="t">
                          <b>{i + 1}. {titleOf(i)}</b>
                          <small>{can ? `${lengthOf(i).toFixed(1)} seconds` : 'No scene yet, so it cannot be exported'}</small>
                        </span>
                        <Chip status={s} />
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="rowf">
                <button type="button" className="btn pri" disabled={n === 0} onClick={start}>
                  {n ? `Start export (${n} ${n === 1 ? 'beat' : 'beats'})` : 'Start export'}
                </button>
                {n === 0 && <span className="hint">Pick at least one beat.</span>}
              </div>
              <p className="hint">Export files expire after a while. Expired files can be rebuilt by exporting again.</p>
            </>
          ) : (
            <p className="empty">No beats yet. Beats show up as the agent finishes them.</p>
          )}
        </section>

        <section aria-labelledby="h-exp">
          <h2 className="first" id="h-exp">Exports</h2>
          {shown.length === 0 ? (
            <div className="card pad stack">
              <b>No exports yet</b>
              <p className="muted">Pick beats above and start an export. It will show up here.</p>
            </div>
          ) : (
            <ul className="stack">
              {shown.map((e) => {
                const [label, kind] = EXP[e.status];
                const active = e.status === 'queued' || e.status === 'running';
                const mb = e.files.reduce((a, i) => a + fileMb(i), 0);
                return (
                  <li key={e.id}>
                    <article className="card exp">
                      <div className="rowf">
                        <b>Export · {e.when}</b>
                        <span className="spacer" />
                        <span className={`chip ${kind}`}>{label}</span>
                      </div>

                      {active && (
                        <>
                          <div
                            className="bar"
                            role="progressbar"
                            aria-label="Export progress"
                            aria-valuemin={0}
                            aria-valuemax={e.progress[1]}
                            aria-valuenow={e.progress[0]}
                          >
                            <i style={{ width: `${Math.max(2, (e.progress[0] / e.progress[1]) * 100)}%` }} />
                          </div>
                          <span className="hint">{e.progress[0]} / {e.progress[1]} beats</span>
                        </>
                      )}

                      {e.status === 'done' && (
                        <>
                          <div className="rowf">
                            <button type="button" className="btn pri sm"><Icon name="download" />Download zip</button>
                            <button type="button" className="btn sm">Manifest</button>
                            <span className="hint">{e.files.length} files, {mb.toFixed(1)} MB. Expires {e.expires}.</span>
                          </div>
                          <details className="flist-wrap">
                            <summary>Show files</summary>
                            <ul className="flist">
                              {e.files.map((i) => (
                                <li key={i}><span>#{i + 1} {fileName(i)}</span><span className="hint">{fileSize(i)}</span></li>
                              ))}
                            </ul>
                          </details>
                        </>
                      )}

                      {e.status === 'expired' && (
                        <div className="note warn"><div>These files have expired. Export again to rebuild them.</div></div>
                      )}
                      {e.status === 'failed' && (
                        <div className="note bad" role="alert"><div>The export stopped. Try again in a minute.</div></div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
