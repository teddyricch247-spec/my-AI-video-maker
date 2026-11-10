/**
 * Demo for tech/matrix-2x2: 2x2 matrix with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './matrix-2x2.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/matrix-2x2'].draw(g, t, { xAxis: 'COST', yAxis: 'VALUE', quads: ['Do now', 'Plan', 'Maybe', 'Skip'], items: ['Cache|.2|.9', 'Rewrite|.9|.8', 'Logo|.15|.2', 'Blog|.8|.25'], highlight: 0 });
}
