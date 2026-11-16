import Link from 'next/link';
import { STATUS, titleOf } from '@/lib/data';

// Progress strip, one segment per beat.
// Pass `id` to make each segment a link to its beat (don't do that inside another link).
export default function Rail({ beats, current, id }) {
  const done = beats.filter((b) => b === 'approved').length;
  const label = `${done} of ${beats.length} beats approved${current != null ? `, viewing beat ${current + 1}` : ''}`;

  if (id) {
    return (
      <nav className="rail rail-nav" aria-label={`Jump to a beat. ${label}`}>
        {beats.map((s, i) => (
          <Link
            key={i}
            href={`/projects/${id}/beats/${i + 1}`}
            title={`${i + 1}. ${titleOf(i)}: ${STATUS[s][0]}`}
            aria-label={`Beat ${i + 1}, ${titleOf(i)}: ${STATUS[s][0]}`}
            aria-current={current === i ? 'true' : undefined}
          >
            <i className={`${STATUS[s][1]}${current === i ? ' cur' : ''}`} />
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <div className="rail" role="img" aria-label={label}>
      {beats.map((s, i) => (
        <i key={i} className={`${STATUS[s][1]}${current === i ? ' cur' : ''}`} title={`${i + 1}. ${titleOf(i)}: ${STATUS[s][0]}`} />
      ))}
    </div>
  );
}
