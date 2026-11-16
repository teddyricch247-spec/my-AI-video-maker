'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Chip from './Chip';
import { sceneFor } from '@/lib/mock';
import { titleOf } from '@/lib/data';

const LEAD = {
  review: 'The agent finished this beat. Play it all the way through, then approve it or ask for changes.',
  attention: 'The agent finished this beat, but one check needs a closer look. Play it, then decide.',
  revising: 'The agent is revising this beat. You can keep watching the current version.',
  approved: 'Locked in. This beat will be part of your export.',
  running: 'The agent is building this beat. It will show up here when it is ready.',
  queued: 'This beat is waiting its turn. The agent will start on it soon.',
  failed: 'The agent could not finish this beat. Nothing was lost, so you can try again.',
};
const QUICK = ['Slower', 'Bigger text', 'Redo the sound', 'Less motion'];
const STEPS = ['Read the plan', 'Wrote the scene', 'Rendering the frames', 'Checking the result'];
const lower = (s) => s[0].toLowerCase() + s.slice(1);

export default function Review({ status, i = 3 }) {
  const { line: LINE, marks: MARKS, dur: DUR } = sceneFor(i);
  const T0 = Math.min(1.3, DUR * 0.3);
  const start = status === 'approved' ? 'approved' : status === 'running' || status === 'queued' || status === 'failed' ? status : 'review';
  const flagged = status === 'attention';
  const [t, setT] = useState(T0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [watched, setWatched] = useState(start === 'approved');
  const [state, setState] = useState(start);
  const [ver, setVer] = useState(start === 'review' || start === 'approved' ? 2 : 1);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState('');
  const toastTimer = useRef();
  const rate = useRef(1);
  const t0 = useRef(T0);
  t0.current = t;
  rate.current = slow ? 0.5 : 1;

  const say = useCallback((m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf;
    const tick = (now) => {
      const next = t0.current + ((now - last) / 1000) * rate.current;
      last = now;
      if (next >= DUR) {
        t0.current = 0;
        setT(0);
        setPlaying(false);
        setWatched((w) => {
          if (!w) say('Nice. You can approve this beat now.');
          return true;
        });
        return;
      }
      t0.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, say, DUR]);
  useEffect(() => {
    if (state !== 'revising') return;
    const id = setInterval(() => {
      setProgress((p) => {
        if (p + 2.5 < 100) return p + 2.5;
        clearInterval(id);
        setVer((v) => v + 1);
        setState('review');
        setWatched(false);
        setT(0);
        setProgress(0);
        say('A new version is ready to review.');
        return 100;
      });
    }, 90);
    return () => clearInterval(id);
  }, [state, say]);

  const jump = (s) => { setPlaying(false); setT(s); };
  const cur = LINE.reduce((a, w, k) => (t >= w[1] ? k : a), 0);
  const mark = MARKS.find((m) => Math.abs(m[0] - t) < 0.4);
  const canAct = state === 'review' || state === 'failed';
  const building = state === 'running' || state === 'queued' || state === 'failed';
  const showBar = state !== 'running' && state !== 'queued';

  const primary = () => {
    if (state === 'approved') return;
    if (state === 'failed') {
      setState('running');
      say('The agent is trying again.');
      return;
    }
    if (!watched) {
      jump(0);
      setPlaying(true);
      say('Watch the whole beat first, then approve it.');
      return;
    }
    setState('approved');
    say('Beat approved.');
  };
  const send = () => {
    if (!msg.trim()) { say('Tell the agent what to change first.'); return; }
    setAsking(false);
    setMsg('');
    setProgress(0);
    setState('revising');
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (building) return;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'A') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1);
        setPlaying(false);
        setT((x) => Math.min(DUR, Math.max(0, x + d)));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [building, DUR]);

  const chip =
    state === 'revising' ? <Chip status="running" /> : state === 'review' && flagged ? <Chip status="attention" /> : <Chip status={state} />;
  const lead = state === 'review' && flagged ? LEAD.attention : LEAD[state];
  const sfx = MARKS.map((m) => `a ${lower(m[1])}`).join(' and ');

  return (
    <>
      <div className={`toast up${toast ? ' on' : ''}`} role="status">{toast}</div>
      <div className="grid">
        {building ? (
          <section className="card player" aria-label="Beat status">
            <div className={`stage wait${state === 'failed' ? ' bad' : ''}`}>
              <div className="waitbox">
                {state === 'running' && <span className="spin" aria-hidden="true" />}
                <b>{titleOf(i)}</b>
                <span>
                  {state === 'running' && 'Building. Usually under a minute.'}
                  {state === 'queued' && 'Waiting for a free agent.'}
                  {state === 'failed' && 'This beat did not finish.'}
                </span>
              </div>
            </div>
            {state === 'running' && (
              <ol className="live" aria-label="Build steps">
                {STEPS.map((s, k) => (
                  <li key={s} className={k < 2 ? 'done' : k === 2 ? 'now' : ''}>
                    <span aria-hidden="true">{k < 2 ? '✓' : k === 2 ? '…' : ''}</span>{s}
                  </li>
                ))}
              </ol>
            )}
            {state === 'queued' && <p className="legend">Beats are built one after another. This one is next in line, and the page will update when it starts.</p>}
            {state === 'failed' && (
              <div className="note bad" role="alert" style={{ marginTop: 14 }}>
                <div><b>What went wrong. </b>The model took too long to answer (120 s). Trying again usually works.</div>
              </div>
            )}
          </section>
        ) : (
          <section className="card player" aria-label="Beat preview">
            <div className="stage">
              <p aria-label={LINE.map((w) => w[0]).join(' ')}>
                {LINE.map(([w], k) => (
                  <span key={k} aria-hidden="true" className={k === cur ? 'h' : k < cur ? 'p' : ''}>{w} </span>
                ))}
              </p>
              <span className={`tag${mark ? ' on' : ''}`} aria-hidden="true">{mark ? mark[1] : ''}</span>
            </div>
            <div className="ctl">
              <button className="pbtn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
              <div className="scrub">
                <input type="range" min="0" max={DUR} step="0.05" value={t} onChange={(e) => jump(+e.target.value)} aria-label="Seek" aria-valuetext={`${t.toFixed(1)} of ${DUR.toFixed(1)} seconds`} />
                {MARKS.map(([s, label]) => (
                  <button key={s} className="mk" style={{ left: `${(s / DUR) * 100}%` }} title={label} aria-label={`${label} at ${s} seconds`} onClick={() => jump(s)} />
                ))}
              </div>
              <span className="time">{t.toFixed(1)} / {DUR.toFixed(1)}s</span>
              <button className="rate" aria-pressed={slow} aria-label="Playback speed" onClick={() => setSlow(!slow)}>{slow ? '0.5×' : '1×'}</button>
            </div>
            <div className="words" role="group" aria-label="Jump to a word">
              {LINE.map(([w, s], k) => (
                <button key={k} className={k === cur ? 'on' : ''} aria-current={k === cur ? 'true' : undefined} onClick={() => jump(s)}>{w}</button>
              ))}
            </div>
            <p className="legend">Orange diamonds on the timeline are sound effects. Space plays or pauses, arrow keys step through.</p>
          </section>
        )}

        <aside className="card review" aria-label="Review">
          <div className="rh">
            <b>Review</b>
            <span className="chips">{chip}{ver > 1 && !building && <span className="chip gray">Version {ver}</span>}</span>
          </div>
          <p className="lead">{lead}</p>
          {state === 'revising' && (
            <div className="bar" role="progressbar" aria-label="Revising" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
          )}
          {state === 'running' && <p className="hint" style={{ marginTop: 10 }}>You can leave this page. The agent keeps building.</p>}

          {!building && (
            <>
              <h3>What the agent did</h3>
              <ul className="did">
                <li>Timed all {LINE.length} words to your narration</li>
                <li>Added {sfx}</li>
                <li>Checked layout, timing and loudness</li>
              </ul>

              <h3>Checks</h3>
              <div className="chk"><span>Text stays inside the frame</span><span className="chip ok">Passed</span></div>
              <div className="chk"><span>Every word lands on its spoken time</span><span className="chip ok">Passed</span></div>
              <div className="chk"><span>Whoosh is 2 dB louder than the voice</span><button className="link" onClick={() => jump(MARKS[0][0])}>Hear it</button><span className="chip warn">Warning</span></div>
            </>
          )}

          {asking && (
            <div className="revise">
              <h3>What should change?</h3>
              <label className="sr" htmlFor="msg">What should change?</label>
              <textarea id="msg" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Describe it in plain words, like “make the text bigger”" autoFocus />
              <div className="qc">
                {QUICK.map((q) => <button key={q} onClick={() => setMsg((m) => (m ? `${m.trim()} ` : '') + `${q}.`)}>{q}</button>)}
              </div>
              <button className="btn pri wide" onClick={send}>Send to agent</button>
            </div>
          )}

          {showBar && (
            <div className="actions">
              <button className="btn" disabled={!canAct} aria-expanded={asking} onClick={() => setAsking(!asking)}>Request changes</button>
              <button className={`btn ${state === 'approved' ? 'done' : 'pri'}`} disabled={!canAct && state !== 'approved'} onClick={primary}>
                {state === 'approved' ? 'Approved ✓' : state === 'failed' ? 'Try again' : watched ? 'Approve beat' : 'Play to review'}
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
