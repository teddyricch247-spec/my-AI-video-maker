/**
 * Demo for tech/chart-draw: Chart (bar, line or donut) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './chart-draw.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-a.js';
export function demo(g, t) {
  assets['tech/chart-draw'].draw(g, t, { type: 'line', title: 'Revenue per month', data: [12, 18, 15, 27, 33, 41], labels: ['Jan','Feb','Mar','Apr','May','Jun'], unit: 'k' });
}
