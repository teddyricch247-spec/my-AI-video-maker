'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Switch from './Switch';
import { FPS, SIZES } from '@/lib/mock';

const NEXT = [
  ['Add your transcript', 'Upload a text file or paste the narration.'],
  ['The Director plans the beats', 'Chat with it to change the plan before you approve.'],
  ['Review each beat', 'Watch it, then approve it or ask for changes.'],
  ['Export', 'One MP4 per beat, plus a manifest.'],
];

export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [fps, setFps] = useState(30);
  const [size, setSize] = useState('1920x1080');
  const [sfx, setSfx] = useState(true);
  const ready = name.trim().length > 0;
  const [, label, dims] = SIZES.find((s) => s[0] === size);

  // Prototype: no request. Lands on Setup for a fresh draft project.
  const submit = (e) => {
    e.preventDefault();
    if (ready) router.push('/projects/new-project/setup');
  };

  return (
    <form className="cols" onSubmit={submit} noValidate>
      <section className="card pad stack" aria-label="Project details">
        <div className="fld">
          <label htmlFor="np-name">Name</label>
          <input
            id="np-name"
            className="inp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Launch video"
            autoComplete="off"
            required
          />
        </div>

        <fieldset className="grp">
          <legend>Frame rate</legend>
          <div className="pills">
            {FPS.map((v) => (
              <label className="pill" key={v}>
                <input type="radio" name="fps" value={v} checked={fps === v} onChange={() => setFps(v)} />
                <span>{v} fps</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="grp">
          <legend>Export size</legend>
          <div className="optgrid">
            {SIZES.map(([v, l, d]) => (
              <label className="optile" key={v}>
                <input type="radio" name="size" value={v} checked={size === v} onChange={() => setSize(v)} />
                <span><b>{l}</b><small>{d}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <Switch
          id="np-sfx"
          checked={sfx}
          onChange={setSfx}
          label="Generate sound effects"
          hint="The agent adds whooshes, pops and other sounds that match the words."
        />

        <div className="rowf">
          <Link href="/" className="btn">Cancel</Link>
          <span className="spacer" />
          <button type="submit" className="btn pri" disabled={!ready}>Create project</button>
        </div>
      </section>

      <aside className="stack" aria-label="Summary">
        <div className="card pad stack mini">
          <div className="stage" role="img" aria-label="Preview of the project title">
            <p className="p">{name.trim() || 'Your title'}</p>
          </div>
          <div className="tagrow">
            <span className="chip gray">{dims}</span>
            <span className="chip gray">{label}</span>
            <span className="chip gray">{fps} fps</span>
            <span className={`chip ${sfx ? 'ok' : 'gray'}`}>{sfx ? 'Sound on' : 'Silent'}</span>
          </div>
        </div>
        <div className="card pad stack">
          <h2 className="ttl">What happens next</h2>
          <ol className="steps">
            {NEXT.map(([t, d]) => (
              <li key={t}><div><b>{t}</b><small>{d}</small></div></li>
            ))}
          </ol>
        </div>
      </aside>
    </form>
  );
}
