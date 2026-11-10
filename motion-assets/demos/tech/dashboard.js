/**
 * Demo for tech/dashboard: Dashboard (KPIs + sparklines) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './dashboard.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/dashboard'].draw(g, t, { title: 'Q3 at a glance', kpis: ['MRR|12.4|+9%', 'Users|3.1|+4%', 'Churn|1.2|-0.2%', 'NPS|71|+3'], units: ['k', 'k', '%', ''], trendLabel: 'Signups per week' });
}
