/**
 * Demo for tech/architecture: Architecture (client - server - database) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './architecture.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/architecture'].draw(g, t, { title: 'One request, three hops', nodes: ['App', 'Cache', 'Store'], latencies: ['2 ms', '30 ms'], request: 'POST' });
}
