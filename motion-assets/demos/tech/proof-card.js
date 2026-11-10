/**
 * Demo for tech/proof-card: Proof card (screenshot on paper) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './proof-card.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-b.js';
export function demo(g, t) {
  assets['tech/proof-card'].draw(g, t, { caption: 'Dashboard, week 3', badge: 'REAL DATA', ring: [.08, .3, .3, .2] });
}
