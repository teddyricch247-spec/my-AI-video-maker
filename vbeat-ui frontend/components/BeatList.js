'use client';
import Link from 'next/link';
import { useState } from 'react';
import Chip from './Chip';
import { titleOf, lengthOf } from '@/lib/data';

const FILTERS = [
  ['all', 'All'],
  ['review', 'To review'],
  ['running', 'Building'],
  ['approved', 'Approved'],
];
const match = (f, s) => f === 'all' || s === f || (f === 'review' && (s === 'attention' || s === 'failed'));

export default function BeatList({ id, beats, current }) {
  const [f, setF] = useState('all');
  const rows = beats.map((s, i) => ({ s, i })).filter((r) => match(f, r.s));
  return (
    <>
      <div className="filters" role="group" aria-label="Filter beats">
        {FILTERS.map(([k, l]) => (
          <button key={k} aria-pressed={f === k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>
        ))}
      </div>
      <ul className="tiles">
        {rows.map(({ s, i }) => (
          <li key={i}>
            <Link href={`/projects/${id}/beats/${i + 1}`} className={`card tile${current === i ? ' cur' : ''}`} aria-current={current === i ? 'true' : undefined}>
              <Chip status={s} />
              <b>{i + 1}. {titleOf(i)}</b>
              <small>{lengthOf(i).toFixed(1)} seconds</small>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="empty">Nothing here yet. Beats show up as the agent finishes them.</p>}
    </>
  );
}
