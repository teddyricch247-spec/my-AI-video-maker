/**
 * Demo for tech/checklist-reveal: Checklist reveal with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './checklist-reveal.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-a.js';
export function demo(g, t) {
  assets['tech/checklist-reveal'].draw(g, t, { title: 'Launch day', items: ['DNS updated', 'Backups on', 'Pricing page live', 'Legal text'], marks: ['check','check','check','cross'] });
}
