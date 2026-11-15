'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import Confirm from './Confirm';
import StatePreview from './StatePreview';
import { planFor, BIBLE, VALIDATION, CHAT, QUICK } from '@/lib/mock';

const MODE = { technical: ['Technical', 'pri'], story: ['Story', 'ok'], either: ['Either', 'gray'] };
const RUN = [
  ['run_all', 'Run all', 'Build every beat right away.'],
  ['pilot', 'Pilot first', 'Pause after beat 1 so you can check the look before the rest are built.'],
];
const clip = (s) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);

function Chat({ msgs, draft, setDraft, send, readOnly }) {
  const box = useRef(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs.length]);
  const waiting = msgs.some((m) => m.queued);

  return (
    <section className="card chatcard pane-chat" aria-label="Chat with the Director">
      <div className="chath">
        <b>Director</b>
        <span className={`chip ${waiting ? 'warn' : 'ok'}`}>{waiting ? 'Working' : 'Ready'}</span>
      </div>
      <div className="msgs" ref={box} role="log" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <span className="who">
              {m.role === 'dir' ? 'Director' : 'You'}
              {m.queued && <span className="chip gray">Waiting</span>}
            </span>
            <div className="bub">{m.text}</div>
            {m.steps && (
              <ul className="stp">
                {m.steps.map((s) => <li key={s}>✓ {s}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="composer">
        {readOnly ? (
          <p className="hint">The plan is approved, so the Director chat is closed.</p>
        ) : (
          <>
            <div className="qc">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => setDraft((d) => `${d ? `${d.trim()} ` : ''}${q}.`)}>{q}</button>
              ))}
            </div>
            <label className="sr" htmlFor="dir-msg">Message to the Director</label>
            <textarea
              id="dir-msg"
              className="inp"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Describe a change in plain words"
            />
            <div className="rowf">
              <span className="hint">Enter sends, Shift + Enter adds a line.</span>
              <span className="spacer" />
              <button type="button" className="btn pri sm" onClick={send} disabled={!draft.trim()}>
                <Icon name="send" />Send
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default function PlanView({ id, beats, words }) {
  const plan = planFor(beats);
  const [view, setView] = useState(beats.length ? 'review' : 'start'); // start | review | issues | approved
  const [tab, setTab] = useState('plan');
  const [mode, setMode] = useState('run_all');
  const [ask, setAsk] = useState(false);
  const [msgs, setMsgs] = useState(CHAT);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');

  const approved = view === 'approved';
  const issues = view === 'issues' ? VALIDATION : [];
  const total = plan.reduce((a, b) => a + b.dur, 0);
  const counts = plan.reduce((a, b) => ({ ...a, [b.mode]: (a[b.mode] || 0) + 1 }), {});

  // Prototype: a sent message just joins the list as "waiting". No Director behind it.
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMsgs((m) => [...m, { id: Date.now(), role: 'user', text, queued: true }]);
    setDraft('');
  };

  return (
    <div className="sect">
      <StatePreview
        options={[['start', 'Start'], ['review', 'Ready'], ['issues', 'Has issues'], ['approved', 'Approved']]}
        value={view}
        onChange={setView}
      />

      {view === 'start' ? (
        <section className="card pad stack" style={{ maxWidth: 680 }}>
          <h2 className="ttl">Ask the Director for a plan</h2>
          <p className="muted">The Director reads your transcript and proposes beats and a story bible. You can chat to change it before approving.</p>
          <div className="fld">
            <label htmlFor="plan-ins">Instructions <span className="opt-label">(optional)</span></label>
            <textarea
              id="plan-ins"
              className="inp"
              rows={4}
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Tone, length of beats, things to avoid"
            />
          </div>
          <div className="qc">
            {['Short beats', 'Keep it technical', 'More storytelling', 'No stock footage'].map((q) => (
              <button key={q} type="button" onClick={() => setHint((d) => `${d ? `${d.trim()} ` : ''}${q}.`)}>{q}</button>
            ))}
          </div>
          <div className="rowf">
            <button type="button" className="btn pri" disabled={!words} onClick={() => setView('review')}>Start planning</button>
            {!words && <span className="hint">Add a transcript in <Link href={`/projects/${id}/setup`} className="lnk">Setup</Link> first.</span>}
          </div>
        </section>
      ) : (
        <div className="cols plan-cols" data-tab={tab}>
          <div className="seg" role="tablist" aria-label="Plan view">
            {[['plan', 'Plan'], ['chat', 'Chat']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          <section className="pane-plan" aria-label="Plan">
            <div className="rowf">
              <h2 className="ttl">{plan.length} beats</h2>
              <span className="muted">{total.toFixed(1)} s in total</span>
              <span className="spacer" />
              <span className="tagrow">
                {Object.entries(counts).map(([m, n]) => (
                  <span key={m} className={`chip ${MODE[m][1]}`}>{n} {MODE[m][0].toLowerCase()}</span>
                ))}
              </span>
            </div>

            {issues.length > 0 && (
              <div className="note warn" role="alert">
                <div>
                  <b>Fix these before approving</b>
                  <ul className="vlist">{issues.map((v) => <li key={v}>{v}</li>)}</ul>
                </div>
              </div>
            )}

            <ul className="stack">
              {plan.map((b) => (
                <li key={b.n}>
                  <article className="card pitem">
                    <div className="pi-top">
                      <span className="idx">{b.n}</span>
                      <span>{b.start}</span>
                      <span>{b.dur.toFixed(1)} s</span>
                      <span className={`chip ${MODE[b.mode][1]}`}>{MODE[b.mode][0]}</span>
                    </div>
                    <h3 className="ttl">{b.title}</h3>
                    <p className="dir">{b.direction}</p>
                    <p className="txt">“{clip(b.text)}”</p>
                  </article>
                </li>
              ))}
            </ul>

            <details className="card bible">
              <summary>Story bible</summary>
              <dl>
                {BIBLE.map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </details>
          </section>

          <aside className="rcol">
            <section className="card approve" aria-label="Approve the plan">
              {approved ? (
                <div className="stack">
                  <span className="chip ok" style={{ alignSelf: 'flex-start' }}>Approved</span>
                  <h2 className="ttl">Plan approved</h2>
                  <p className="muted">The beat agents are building. This page is now read-only.</p>
                  <Link href={`/projects/${id}`} className="btn pri wide">Go to beats</Link>
                </div>
              ) : (
                <div className="stack">
                  <h2 className="ttl">Approve the plan</h2>
                  <fieldset className="grp">
                    <legend className="sr">Run mode</legend>
                    <div className="stack" style={{ gap: 10 }}>
                      {RUN.map(([v, l, d]) => (
                        <label className="optile" key={v}>
                          <input type="radio" name="run_mode" value={v} checked={mode === v} onChange={() => setMode(v)} />
                          <span><b>{l}</b><small>{d}</small></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <button type="button" className="btn pri wide" disabled={issues.length > 0} onClick={() => setAsk(true)}>Approve plan</button>
                  <p className="hint">{issues.length ? 'Fix the validation messages first.' : 'You cannot change the plan after this.'}</p>
                </div>
              )}
            </section>

            <Chat msgs={msgs} draft={draft} setDraft={setDraft} send={send} readOnly={approved} />
          </aside>
        </div>
      )}

      <Confirm
        open={ask}
        title="Approve this plan?"
        message={`Beat agents will start building right away${mode === 'pilot' ? ' and pause after beat 1' : ''}. The plan can no longer be changed.`}
        ok="Approve and build"
        onCancel={() => setAsk(false)}
        onOk={() => { setAsk(false); setView('approved'); }}
      />
    </div>
  );
}
