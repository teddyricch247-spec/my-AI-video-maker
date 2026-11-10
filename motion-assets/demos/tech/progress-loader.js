/**
 * Demo for tech/progress-loader: Progress loader + skeleton with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './progress-loader.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/progress-loader'].draw(g, t, { label: 'Uploading 48 photos…', pct: 100, loaded: ['Album ready', '48 photos', 'Share link'], fill: 3 });
}
