/**
 * Demo for tech/title-card: Title card with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './title-card.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-b.js';
export function demo(g, t) {
  assets['tech/title-card'].draw(g, t, { kicker: 'PART TWO', lines: ['Why it', 'breaks'], accent: 1, sub: 'and how to fix it' });
}
