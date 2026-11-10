/**
 * Demo for tech/quote-card: Quote card with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './quote-card.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/quote-card'].draw(g, t, { quote: 'Setup took ten minutes and it just worked on day one.', author: 'Jo K., Founder', mark: 'it just worked' });
}
