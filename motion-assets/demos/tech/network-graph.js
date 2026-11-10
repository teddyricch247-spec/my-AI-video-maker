/**
 * Demo for tech/network-graph: Network graph with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './network-graph.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/network-graph'].draw(g, t, { title: 'Services talk to each other', labels: ['Core', 'Auth', 'Billing', 'Search', 'Mail', 'Files'] });
}
