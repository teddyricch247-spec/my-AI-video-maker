import { STATUS, titleOf } from '@/lib/data';
export default function Rail({ beats, current }) {
  const done = beats.filter((b) => b === 'approved').length;
  return (
    <div className="rail" role="img" aria-label={`${done} of ${beats.length} beats approved${current != null ? `, viewing beat ${current + 1}` : ''}`}>
      {beats.map((s, i) => (
        <i key={i} className={`${STATUS[s][1]}${current === i ? ' cur' : ''}`} title={`${i + 1}. ${titleOf(i)}: ${STATUS[s][0]}`} />
      ))}
    </div>
  );
}
