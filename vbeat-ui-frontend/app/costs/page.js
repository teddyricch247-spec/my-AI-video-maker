import { projects } from '@/lib/data';

export const metadata = { title: 'Costs' };

const DAYS = [['Mon', 0.12], ['Tue', 0.31], ['Wed', 0.08], ['Thu', 0.22], ['Fri', 0.4], ['Sat', 0.05], ['Sun', 0.18]];
const MAX = Math.max(...DAYS.map((d) => d[1]));
const TODAY = 0.18;
const LIMIT = 20;

export default function Costs() {
  return (
    <>
      <h1>Costs</h1>
      <p className="sub">What your projects have cost so far.</p>
      <section className="card big" aria-label="Spent today">
        <span>Spent today</span>
        <b>${TODAY.toFixed(2)}</b>
        <small>of your ${LIMIT.toFixed(2)} daily limit</small>
        <div className="bar" role="progressbar" aria-label="Daily limit used" aria-valuemin={0} aria-valuemax={LIMIT} aria-valuenow={TODAY}><i style={{ width: `${Math.max(1, (TODAY / LIMIT) * 100)}%` }} /></div>
      </section>
      <div className="two">
        <section>
          <h2>Last 7 days</h2>
          <div className="card chart">
            <div className="bars" role="img" aria-label={`Daily spend: ${DAYS.map(([d, v]) => `${d} $${v.toFixed(2)}`).join(', ')}`}>
              {DAYS.map(([d, v], k) => (
                <div key={d} className={k === DAYS.length - 1 ? 'today' : ''}><em>${v.toFixed(2)}</em><i style={{ height: `${(v / MAX) * 100}%` }} /><small>{k === DAYS.length - 1 ? 'Today' : d}</small></div>
              ))}
            </div>
          </div>
        </section>
        <section>
          <h2>By project</h2>
          <ul className="card rows">
            {projects.map((p) => (
              <li key={p.id}><span><b>{p.name}</b><small>{p.beats.length} beats</small></span><b>${p.spent.toFixed(2)}</b></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
