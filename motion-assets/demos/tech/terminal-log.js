/**
 * Demo for tech/terminal-log: Terminal log with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './terminal-log.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/terminal-log'].draw(g, t, { lines: ['$ git push origin main', 'ERR  rejected: behind remote', '$ git pull --rebase', 'OK  rebased 2 commits', '$ git push', 'OK  pushed to main'] });
}
