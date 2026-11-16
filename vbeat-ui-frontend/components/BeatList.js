'use client';
import Link from 'next/link';
import { useState } from 'react';
import Chip from './Chip';
import { titleOf, lengthOf } from '@/lib/data';

const FILTERS = [
  ['all', 'All'],
  ['review', 'To review'],
  ['running', 'In progress'],
  ['approved', 'Approved'],
];
const match = (f, s) =>
  f === 'all' ||
  s === f ||
  (f === 'review' && (s === 'attention' || s === 'failed')) ||
  (f === 'running' && s === 'queued');

export default function BeatList({ id, beats, current }) {
  const [f, setF] = useState('all');
  const all = beats.map((s, i) => ({ s, i }));
  const rows = all.filter((r) => match(f, r.s));
  const n = (k) => all.filter((r) => match(k, r.s)).length;
  return (
    <>
      <div className="filters" role="group" aria-label="Filter beats">
        {FILTERS.map(([k, l]) => (
          <button key={k} aria-pressed={f === k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>
            {l} <span className="n">{n(k)}</span>
          </button>
        ))}
      </div>
      <ul className="tiles">
        {rows.map(({ s, i }) => (
          <li key={i}>
            <Link href={`/projects/${id}/beats/${i + 1}`} className={`card tile${current === i ? ' cur' : ''}`} aria-current={current === i ? 'true' : undefined}>
              <span className="bn" aria-hidden="true">{i + 1}</span>
              <b><span className="sr">Beat {i + 1}: </span>{titleOf(i)}</b>
              <span className="ts"><Chip status={s} /><small>{lengthOf(i).toFixed(1)} seconds</small></span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="empty">Nothing here yet. Beats show up as the agent works on them.</p>}
    </>
  );
}
