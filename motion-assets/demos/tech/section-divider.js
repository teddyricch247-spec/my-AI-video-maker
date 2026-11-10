/**
 * Demo for tech/section-divider: Section divider with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './section-divider.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/section-divider'].draw(g, t, { number: '03', title: 'The results', sub: 'what changed after week four' });
}
