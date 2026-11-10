/**
 * Demo for tech/metro-map: Metro map (branch and merge) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './metro-map.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/seeds.js';
export function demo(g, t) {
  assets['tech/metro-map'].draw(g, t, { kicker: 'RELEASE MAP  No. 7', words: ['Plan.', 'Ship.', 'Learn.'], lineLabels: ['main', 'feature/search', 'hotfix'], lineW: [74, 150, 90], stations: ['start', 'search box', 'tests pass', 'fix typo', 'live'], commits: ['c1d4', '9ab0'], flag: 'v1.4' });
}
