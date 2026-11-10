/**
 * Demo for tech/flow-diagram: Flow diagram (3-6 nodes) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './flow-diagram.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-a.js';
export function demo(g, t) {
  assets['tech/flow-diagram'].draw(g, t, { title: 'Upload to done', nodes: ['Upload', 'Resize', 'Scan', 'Store', 'Notify'], notes: ['user', 'worker', 'antivirus', 'bucket', 'email'] });
}
