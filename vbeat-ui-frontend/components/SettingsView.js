'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Confirm from './Confirm';
import Switch from './Switch';
import { useToast } from './Toast';
import { MODELS, SETTINGS, CAP_FIELDS } from '@/lib/mock';

const money = (n) => `$${n.toFixed(2)}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Section({ title, hint, children, dirty, onSave, onUndo, saveLabel = 'Save', canSave = true }) {
  return (
    <section className="card pad stack" aria-label={title}>
      <div>
        <h2 className="ttl">{title}</h2>
        {hint && <p className="hint">{hint}</p>}
      </div>
      {children}
      {onSave && (
        <div className="rowf">
          <button type="button" className="btn pri sm" disabled={!dirty || !canSave} onClick={onSave}>{saveLabel}</button>
          {dirty && <button type="button" className="btn sm" onClick={onUndo}>Undo changes</button>}
          {dirty && <span className="hint">Unsaved changes</span>}
        </div>
      )}
    </section>
  );
}

function ModelPicker({ id, label, value, onChange, needs }) {
  const [q, setQ] = useState('');
  const list = MODELS.filter((m) => !q.trim() || `${m.name} ${m.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  const m = MODELS.find((x) => x.id === value);
  const warn = [];
  if (m && needs.tools && !m.supports_tools) warn.push(`This model does not support tools, so ${label} work will fail.`);
  if (m && needs.images && !m.supports_images) warn.push('This model cannot read images, so scene frames cannot be reviewed.');
  return (
    <fieldset className="grp">
      <legend>{label} model</legend>
      <label className="sr" htmlFor={`${id}-q`}>Search {label} models</label>
      <input id={`${id}-q`} className="inp" type="search" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mlist" role="radiogroup" aria-label={`${label} model`}>
        {list.map((x) => (
          <label className="mrow" key={x.id}>
            <input type="radio" name={id} value={x.id} checked={value === x.id} onChange={() => onChange(x.id)} />
            <span className="mbody">
              <b>{x.name}</b>
              <small>${x.price_in} in / ${x.price_out} out per 1M tokens</small>
              <span className="tagrow">
                <span className={`chip ${x.supports_tools ? 'ok' : 'gray'}`}>{x.supports_tools ? 'Tools' : 'No tools'}</span>
                <span className={`chip ${x.supports_images ? 'ok' : 'gray'}`}>{x.supports_images ? 'Vision' : 'No vision'}</span>
              </span>
            </span>
          </label>
        ))}
        {list.length === 0 && <p className="empty" style={{ padding: '10px 14px' }}>No models match.</p>}
      </div>
      {warn.map((w) => <div key={w} className="note warn" role="alert"><div>{w}</div></div>)}
    </fieldset>
  );
}

export default function SettingsView() {
  const router = useRouter();
  const [say, toast] = useToast();

  // models
  const [models, setModels] = useState(SETTINGS.models);
  const [savedModels, setSavedModels] = useState(SETTINGS.models);

  // caps (kept as strings while typing)
  const toStr = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
  const [caps, setCaps] = useState(toStr(SETTINGS.caps));
  const [savedCaps, setSavedCaps] = useState(toStr(SETTINGS.caps));
  const [tried, setTried] = useState(false);
  const capErr = (k, min) => {
    const v = caps[k];
    return v.trim() === '' || !Number.isFinite(Number(v)) || Number(v) < min ? `Enter a number of ${min} or more.` : '';
  };
  const capsBad = CAP_FIELDS.some(([k, , min]) => capErr(k, min));

  // runtime
  const rt0 = { c: String(SETTINGS.beat_concurrency), p: String(SETTINGS.sfx_peak_dbfs) };
  const [rt, setRt] = useState(rt0);
  const [savedRt, setSavedRt] = useState(rt0);
  const cN = Number(rt.c);
  const pN = Number(rt.p);
  const cErr = rt.c.trim() === '' || !Number.isInteger(cN) || cN < 1 || cN > 27 ? 'Use a whole number from 1 to 27.' : '';
  const pErr = rt.p.trim() === '' || !Number.isFinite(pN) || pN < -12 || pN > -1 ? 'Use a number from -12 to -1.' : '';

  // kill switch
  const [kill, setKill] = useState(SETTINGS.kill_switch);
  const [askKill, setAskKill] = useState(false);

  const spend = SETTINGS.spend_today_usd;
  const limit = Number(savedCaps.daily_usd);

  return (
    <>
      <div className="head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Models, spending limits and the emergency stop.</p>
        </div>
        <span className="chip gray spendchip">Today {money(spend)} of {money(limit)}</span>
      </div>

      {kill && (
        <div className="note bad" role="alert" style={{ marginTop: 18 }}>
          <div><b>The kill switch is on. </b>All agent work is stopped until you turn it off.</div>
        </div>
      )}

      <div className="cols">
        <div className="stack">
          <Section
            title="Models"
            hint="The Director plans the video. A beat agent builds each beat."
            dirty={!same(models, savedModels)}
            onSave={() => { setSavedModels(models); say('Models saved'); }}
            onUndo={() => setModels(savedModels)}
            saveLabel="Save models"
          >
            <ModelPicker id="m-dir" label="Director" value={models.director} onChange={(v) => setModels((m) => ({ ...m, director: v }))} needs={{ tools: true }} />
            <ModelPicker id="m-beat" label="Beat" value={models.beat} onChange={(v) => setModels((m) => ({ ...m, beat: v }))} needs={{ tools: true, images: true }} />
          </Section>

          <Section
            title="Spending caps"
            hint="A run stops by itself when it reaches a cap."
            dirty={!same(caps, savedCaps)}
            canSave={!(tried && capsBad)}
            onSave={() => {
              setTried(true);
              if (capsBad) { say('Fix the highlighted fields first.'); return; }
              setSavedCaps(caps);
              setTried(false);
              say('Caps saved');
            }}
            onUndo={() => { setCaps(savedCaps); setTried(false); }}
            saveLabel="Save caps"
          >
            <div className="capgrid">
              {CAP_FIELDS.map(([k, label, min, step, unit]) => {
                const e = capErr(k, min);
                return (
                  <div className="fld" key={k}>
                    <label htmlFor={`cap-${k}`}>{label}</label>
                    <div className="unit">
                      <input
                        id={`cap-${k}`}
                        className={`inp${tried && e ? ' bad' : ''}`}
                        type="number"
                        inputMode="decimal"
                        min={min}
                        step={step}
                        value={caps[k]}
                        onChange={(ev) => setCaps((c) => ({ ...c, [k]: ev.target.value }))}
                        aria-invalid={tried && e ? 'true' : undefined}
                        aria-describedby={tried && e ? `cap-${k}-e` : undefined}
                      />
                      <span aria-hidden="true">{unit}</span>
                    </div>
                    {tried && e && <p className="errtext" id={`cap-${k}-e`}>{e}</p>}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Runtime"
            dirty={!same(rt, savedRt)}
            canSave={!cErr && !pErr}
            onSave={() => { setSavedRt(rt); say('Runtime settings saved'); }}
            onUndo={() => setRt(savedRt)}
            saveLabel="Save"
          >
            <div className="capgrid">
              <div className="fld">
                <label htmlFor="rt-c">Beat concurrency</label>
                <div className="unit">
                  <input id="rt-c" className={`inp${cErr ? ' bad' : ''}`} type="number" inputMode="numeric" min={1} max={27} step={1} value={rt.c} onChange={(e) => setRt((r) => ({ ...r, c: e.target.value }))} aria-invalid={cErr ? 'true' : undefined} aria-describedby="rt-c-h" />
                  <span aria-hidden="true">at once</span>
                </div>
                <p id="rt-c-h" className={cErr ? 'errtext' : 'hint'}>{cErr || 'How many beats are built at the same time (1 to 27).'}</p>
              </div>
              <div className="fld">
                <label htmlFor="rt-p">Sound effect peak level</label>
                <div className="unit">
                  <input id="rt-p" className={`inp${pErr ? ' bad' : ''}`} type="number" inputMode="numeric" min={-12} max={-1} step={1} value={rt.p} onChange={(e) => setRt((r) => ({ ...r, p: e.target.value }))} aria-invalid={pErr ? 'true' : undefined} aria-describedby="rt-p-h" />
                  <span aria-hidden="true">dBFS</span>
                </div>
                <p id="rt-p-h" className={pErr ? 'errtext' : 'hint'}>{pErr || 'Lower is quieter. Between -12 and -1.'}</p>
              </div>
            </div>
          </Section>
        </div>

        <div className="stack">
          <Section title="Kill switch" hint="Emergency stop for every agent.">
            <Switch
              id="kill"
              checked={kill}
              onChange={() => setAskKill(true)}
              label={kill ? 'On: all work stopped' : 'Off'}
              hint={kill ? 'Turn it off to let agents work again.' : 'Turn it on to stop everything right away.'}
            />
          </Section>

          <Section title="Operations" hint="Is everything connected? Workers, the planner and a one-button self-test.">
            <div><Link href="/ops" className="btn">Open Ops</Link></div>
          </Section>

          <Section title="Account">
            <div><button type="button" className="btn" onClick={() => router.push('/login')}>Log out</button></div>
          </Section>
        </div>
      </div>

      <Confirm
        open={askKill}
        danger={!kill}
        title={kill ? 'Turn the kill switch off?' : 'Turn the kill switch on?'}
        message={kill ? 'Agents may start working again.' : 'All agent work stops immediately until you turn it off again.'}
        ok={kill ? 'Turn off' : 'Stop everything'}
        onCancel={() => setAskKill(false)}
        onOk={() => { setKill(!kill); setAskKill(false); say(kill ? 'Kill switch is off' : 'Kill switch is on'); }}
      />
      {toast}
    </>
  );
}
