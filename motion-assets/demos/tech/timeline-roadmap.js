/**
 * Demo for tech/timeline-roadmap: Timeline / roadmap with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './timeline-roadmap.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-a.js';
export function demo(g, t) {
  assets['tech/timeline-roadmap'].draw(g, t, { title: 'Our year', items: ['Jan|Kickoff', 'Apr|Alpha', 'Aug|Beta', 'Nov|Launch'], current: 2 });
}
