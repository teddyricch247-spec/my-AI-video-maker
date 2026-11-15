'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import StatePreview from './StatePreview';
import { IMAGES, READING, mmss } from '@/lib/mock';

const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export default function SetupView({ id, words }) {
  const [view, setView] = useState(words > 0 ? 'loaded' : 'empty'); // empty | loaded | notimings
  const [file, setFile] = useState('narration.srt');
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const [imgs, setImgs] = useState(IMAGES);
  const [sure, setSure] = useState(null);
  const tInput = useRef(null);
  const iInput = useRef(null);

  const loaded = view !== 'empty';
  const noTimings = view === 'notimings';
  const w = words || 412;
  const dur = Math.round((w / 150) * 60);
  const ext = (file.split('.').pop() || 'txt').toUpperCase();

  // Prototype: pretend the upload was parsed. Plain .txt has no timings, like the real reader.
  const take = (name) => {
    setFile(name);
    setView(/\.txt$/i.test(name) ? 'notimings' : 'loaded');
  };
  const pick = (v) => {
    setView(v);
    if (v === 'loaded') setFile('narration.srt');
    if (v === 'notimings') setFile('narration.txt');
  };
  const addImages = (files) => {
    const added = files.filter((f) => f.type.startsWith('image/')).map((f, i) => ({
      id: `${f.name}-${i}-${f.size}`,
      name: f.name,
      size: kb(f.size),
      hue: (f.name.length * 37) % 360,
    }));
    if (added.length) setImgs((l) => [...l, ...added]);
  };

  return (
    <div className="sect">
      <StatePreview
        options={[['empty', 'Empty'], ['loaded', 'Loaded'], ['notimings', 'No timings']]}
        value={view}
        onChange={pick}
      />

      <div className="stack">
        <section className="card pad stack" aria-labelledby="h-tr">
          <div>
            <h2 className="ttl" id="h-tr">1. Transcript</h2>
            <p className="hint">The narration, with timings if you have them.</p>
          </div>

          <div
            className={`drop${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) take(f.name);
            }}
          >
            <i><Icon name="upload" /></i>
            <b>Drop a transcript here</b>
            <span className="hint">Any text file: .srt, .vtt, .json, .txt, .docx. A new upload replaces the earlier one.</span>
            <button type="button" className="btn" onClick={() => tInput.current?.click()}>{loaded ? 'Replace file' : 'Choose file'}</button>
            <input
              ref={tInput}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) take(f.name);
                e.target.value = '';
              }}
            />
          </div>

          <details className="paste">
            <summary>Or paste the text instead</summary>
            <div className="stack">
              <label className="sr" htmlFor="paste">Paste transcript</label>
              <textarea
                id="paste"
                className="inp"
                rows={5}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="Paste the transcript text here"
              />
              <div>
                <button
                  type="button"
                  className="btn"
                  disabled={!paste.trim()}
                  onClick={() => { take('pasted.txt'); setPaste(''); }}
                >
                  Use pasted text
                </button>
              </div>
            </div>
          </details>

          {loaded && (
            <div className="stack" aria-live="polite">
              {noTimings && (
                <div className="note bad" role="alert">
                  <div><b>No timings found. </b>Estimated at about 150 words per minute, so the video will not match your narration audio.</div>
                </div>
              )}
              <div className="kv">
                <div><b>{ext}</b><span>Format</span></div>
                <div><b>{w}</b><span>Words</span></div>
                <div><b>{noTimings ? '~' : ''}{mmss(dur)}</b><span>{noTimings ? 'Estimated length' : 'Length'}</span></div>
              </div>

              <h3>How it was read</h3>
              <p className="rd">
                <span className={`chip ${noTimings ? 'warn' : 'ok'}`}>{noTimings ? 'No timings' : 'Timings found'}</span>
                <span>{noTimings ? 'No timings in the text.' : `Timings read from the file (${READING.cues} cues).`}</span>
              </p>
              {noTimings ? (
                <p className="hint">Use an .srt or .vtt file if you have one. Word highlights will line up much better.</p>
              ) : (
                <>
                  <h3>First cues</h3>
                  <ul className="cues">
                    {READING.first.map((c) => <li key={c.at}><span className="t">{c.at}</span><span>{c.text}</span></li>)}
                  </ul>
                  <h3>Last cues</h3>
                  <ul className="cues">
                    {READING.last.map((c) => <li key={c.at}><span className="t">{c.at}</span><span>{c.text}</span></li>)}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>

        <section className="card pad stack" aria-labelledby="h-im">
          <div>
            <h2 className="ttl" id="h-im">2. Images <span className="opt-label">(optional)</span></h2>
            <p className="hint">The agents can use them in scenes.</p>
          </div>

          <div className="rowf">
            <button type="button" className="btn" onClick={() => iInput.current?.click()}><Icon name="plus" />Add images</button>
            <input
              ref={iInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addImages([...e.target.files]);
                e.target.value = '';
              }}
            />
          </div>

          {imgs.length ? (
            <ul className="thumbs">
              {imgs.map((m) => (
                <li key={m.id} className="card thumb">
                  <div
                    className="img"
                    role="img"
                    aria-label={m.name}
                    style={{ background: `linear-gradient(135deg, hsl(${m.hue} 70% 64%), hsl(${(m.hue + 40) % 360} 65% 42%))` }}
                  />
                  <b title={m.name}>{m.name}</b>
                  <small>{m.size}</small>
                  <button
                    type="button"
                    className={`btn sm del${sure === m.id ? ' on' : ''}`}
                    aria-label={`Delete ${m.name}`}
                    onBlur={() => setSure(null)}
                    onClick={() => {
                      if (sure === m.id) { setImgs((l) => l.filter((x) => x.id !== m.id)); setSure(null); }
                      else setSure(m.id);
                    }}
                  >
                    <Icon name="trash" />{sure === m.id ? 'Tap again' : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No images.</p>
          )}
        </section>

        <div className="rowf">
          {loaded ? (
            <Link href={`/projects/${id}/plan`} className="btn pri">Continue to planning</Link>
          ) : (
            <>
              <button type="button" className="btn pri" disabled>Continue to planning</button>
              <span className="hint">Add a transcript first.</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
