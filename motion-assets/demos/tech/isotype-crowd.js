/**
 * Demo for tech/isotype-crowd: Isotype crowd (100 people, N turn red) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './isotype-crowd.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/seeds.js';
export function demo(g, t) {
  assets['tech/isotype-crowd'].draw(g, t, { left: 27, kicker: 'THE BOUNCE', headline: 'Out of 100 shoppers…', subtitle: 'leave right away.', caption: 'WHEN THE CART IS EMPTY' });
}
