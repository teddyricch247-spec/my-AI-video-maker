/**
 * Demo for tech/calendar-gantt: Gantt / schedule with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './calendar-gantt.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/calendar-gantt'].draw(g, t, { title: 'Launch plan', tasks: ['Brief|0|1', 'Design|1|3', 'Build|3|3', 'QA|5|2'], weeks: 7, today: 2 });
}
