import { counts } from '@/lib/data';
export default function Stats({ p }) {
  const c = counts(p.beats);
  const items = [
    ['✓', 'oks', 'ok', `${c.approved} of ${p.beats.length}`, 'Beats approved'],
    ['▶', 'soft', 'pri', c.review, 'Waiting for you'],
    ['…', 'warns', 'warn', c.running, 'Being built'],
    ['$', 'gray', 'mute', `$${p.spent.toFixed(2)}`, 'Spent on this project'],
  ];
  return (
    <section className="stats" aria-label="Project summary">
      {items.map(([icon, bg, fg, v, l]) => (
        <div className="card stat" key={l}>
          <i aria-hidden="true" style={{ background: `var(--${bg})`, color: `var(--${fg})` }}>{icon}</i>
          <div><b>{v}</b><span>{l}</span></div>
        </div>
      ))}
    </section>
  );
}
