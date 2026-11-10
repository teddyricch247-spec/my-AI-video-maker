/**
 * Demo for tech/kanban-board: Kanban board with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './kanban-board.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/kanban-board'].draw(g, t, { title: 'This sprint', cols: ['Backlog|Search,Export,Dark mode', 'Doing|Login fix,Emails', 'Done|Onboarding'] });
}
