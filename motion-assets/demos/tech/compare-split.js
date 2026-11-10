/**
 * Demo for tech/compare-split: Compare split (before/after, A vs B) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './compare-split.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-a.js';
export function demo(g, t) {
  assets['tech/compare-split'].draw(g, t, { leftTitle: 'PLAN A', rightTitle: 'PLAN B', leftValue: '$40', rightValue: '$12', leftItems: ['Per seat', 'Annual only', 'Setup fee'], rightItems: ['Flat rate', 'Monthly', 'No setup'] });
}
