'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Confirm from './Confirm';
import StatePreview from './StatePreview';
import { useToast } from './Toast';
import { MODELS, OPS, SETTINGS } from '@/lib/mock';

const modelName = (id) => MODELS.find((m) => m.id === id)?.name ?? 'not chosen';
const TEST_STEPS = ['Queued the job', 'A worker picked it up', 'Called the model', 'Rendered the beat'];

export default function OpsView() {
  const [view, setView] = useState('ok'); // ok | bad
  const d = OPS[view];
  const [say, toast] = useToast();
  const timers = useRef([]);

  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState(null);
  const [askTest, setAskTest] = useState(false);
  const [test, setTest] = useState({ phase: 'idle', step: 0 }); // idle | pending | done

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };

  // Prototype: results are canned and arrive after a short pause.
  const runCheck = () => {
    setReport(null);
    setChecking(true);
    later(() => { setChecking(false); setReport(OPS[view]); }, 1400);
  };
  const runTest = () => {
    setAskTest(false);
    setTest({ phase: 'pending', step: 0 });
    TEST_STEPS.forEach((_, k) => { if (k > 0) later(() => setTest({ phase: 'pending', step: k }), k * 900); });
    later(() => setTest({ phase: 'done', step: TEST_STEPS.length }), TEST_STEPS.length * 900);
  };
  const reset = (v) => { setView(v); setReport(null); setChecking(false); setTest({ phase: 'idle', step: 0 }); };
  const wake = () => say(view === 'ok' ? 'worker-1: awake. worker-2: awake.' : 'worker-1: awake. worker-3: could not reach it.');
  const copyDebug = async () => {
    try { await navigator.clipboard.writeText(`vbeat self-test debug\n${d.test.message}\n${d.test.meta}`); say('Debug info copied'); }
    catch { say('Could not copy'); }
  };

  return (
    <>
      <div className="head">
        <div>
          <h1>Ops</h1>
          <p className="sub">Is everything connected? Refreshes every few seconds.</p>
        </div>
        <Link href="/settings" className="btn">Settings</Link>
      </div>

      <StatePreview options={[['ok', 'All clear'], ['bad', 'Problems']]} value={view} onChange={reset} />

      <div className="stack" aria-live="polite">
        {d.problems.length === 0
          ? <div className="note ok"><div><b>No problems found.</b></div></div>
          : d.problems.map((p) => <div key={p} className="note warn" role="alert"><div>{p}</div></div>)}
      </div>

      <div className="cols opscols">
        <section className="card pad stack" aria-labelledby="o-status">
          <h2 className="ttl" id="o-status">Status</h2>
          <dl className="facts">
            <div><dt>Planner</dt><dd>{d.planner.id} · up {d.planner.up} · version {d.planner.version}</dd></div>
            <div><dt>Kill switch</dt><dd>{SETTINGS.kill_switch ? 'On' : 'Off'} · spent today ${SETTINGS.spend_today_usd.toFixed(2)}</dd></div>
            <div><dt>Models</dt><dd>Director {modelName(SETTINGS.models.director)}, beat {modelName(SETTINGS.models.beat)}</dd></div>
            <div><dt>Last check-up</dt><dd>{d.planner.reconcile}</dd></div>
            <div><dt>Jobs</dt><dd>{d.queue}</dd></div>
          </dl>
          <div>
            <div className="rowf"><b>Storage</b><span className="spacer" /><span className="hint">{d.storage.summary}</span></div>
            <div className={`bar${d.storage.percent > 85 ? ' hot' : ''}`} role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.storage.percent}><i style={{ width: `${d.storage.percent}%` }} /></div>
            <p className="hint" style={{ marginTop: 8 }}>{d.storage.buckets.join(' · ')}</p>
          </div>
          {d.errors.length > 0 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Recent job errors</h3>
              <ul className="errs">
                {d.errors.map((e) => <li key={e.id}><b>#{e.id} {e.kind}</b> {e.error}</li>)}
              </ul>
            </div>
          )}
        </section>

        <section className="card pad stack" aria-labelledby="o-work">
          <h2 className="ttl" id="o-work">Workers</h2>
          <ul className="wlist">
            {d.workers.map((w) => (
              <li key={w.id}>
                <span className={`dot ${w.state}`} aria-hidden="true" />
                <span className="wmain"><b>{w.id}</b><small>Seen {w.seen}</small></span>
                <span className="wside"><span>{w.label}</span><small>Running {w.running} / {w.slots}</small></span>
              </li>
            ))}
          </ul>
          <div><button type="button" className="btn" onClick={wake}>Wake workers</button></div>
        </section>

        <section className="card pad stack" aria-labelledby="o-check">
          <div>
            <h2 className="ttl" id="o-check">Check everything</h2>
            <p className="hint">Database, storage, keys, the model list and every worker.</p>
          </div>
          <div><button type="button" className="btn pri" onClick={runCheck} disabled={checking}>{checking ? 'Checking…' : 'Check everything'}</button></div>
          {checking && <p className="hint" role="status">Checking. A sleeping worker can take about a minute to answer.</p>}
          {report && (
            <div className="stack" aria-live="polite">
              <div className={`note ${report.problems.length ? 'bad' : 'ok'}`}><div><b>{report.problems.length ? 'Something needs attention.' : 'Everything checks out.'}</b></div></div>
              <ul className="checks">
                {report.checks.map((c) => (
                  <li key={c.name}>
                    <span className={`chip ${c.ok ? 'ok' : 'bad'}`}>{c.ok ? 'OK' : 'Problem'}</span>
                    <span className="cbody"><b>{c.name}</b><small>{c.detail}</small>{!c.ok && c.fix && <small className="fix">What to do: {c.fix}</small>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card pad stack" aria-labelledby="o-test">
          <div>
            <h2 className="ttl" id="o-test">Self-test</h2>
            <p className="hint">One real beat, end to end: queue, worker, model, render.</p>
          </div>
          <div><button type="button" className="btn" onClick={() => setAskTest(true)} disabled={test.phase === 'pending'}>{test.phase === 'pending' ? 'Running…' : 'Run self-test'}</button></div>
          {test.phase === 'pending' && (
            <ol className="live" aria-label="Self-test steps">
              {TEST_STEPS.map((s, k) => (
                <li key={s} className={k < test.step ? 'done' : k === test.step ? 'now' : ''}>
                  <span aria-hidden="true">{k < test.step ? '✓' : k === test.step ? '…' : ''}</span>{s}
                </li>
              ))}
            </ol>
          )}
          {test.phase === 'done' && (
            <div className="stack" aria-live="polite">
              <div className={`note ${d.test.ok ? 'ok' : 'bad'}`}><div><b>{d.test.message}</b></div></div>
              <p className="hint">{d.test.meta}</p>
              <div><button type="button" className="btn sm" onClick={copyDebug}>Copy debug info</button></div>
            </div>
          )}
        </section>
      </div>

      <Confirm
        open={askTest}
        title="Run the self-test?"
        message="It builds one tiny test beat with your chosen beat model, the same way a real project does. It costs a few cents at most."
        ok="Run it"
        onCancel={() => setAskTest(false)}
        onOk={runTest}
      />
      {toast}
    </>
  );
}
