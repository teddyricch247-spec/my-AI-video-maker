/**
 * Demo for tech/funnel: Funnel with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './funnel.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/funnel'].draw(g, t, { title: 'From click to cash', stages: ['Clicks|8200', 'Carts|2100', 'Checkout|760', 'Paid|520'] });
}
