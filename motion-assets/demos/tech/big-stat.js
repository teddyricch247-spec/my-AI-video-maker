/**
 * Demo for tech/big-stat: Big stat (counting number) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './big-stat.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-a.js';
export function demo(g, t) {
  assets['tech/big-stat'].draw(g, t, { value: 3.2, prefix: '$', suffix: 'M', decimals: 1, label: 'raised in the first week', note: 'SOURCE: COMPANY REPORT' });
}
