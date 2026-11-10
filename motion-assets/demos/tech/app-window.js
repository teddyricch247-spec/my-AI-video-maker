/**
 * Demo for tech/app-window: App / browser window with cursor with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './app-window.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-b.js';
export function demo(g, t) {
  assets['tech/app-window'].draw(g, t, { mode: 'form', url: 'app.example.com/join', heading: 'Get early access', inputs: ['Sam Rivera', 'sam@mail.com'], button: 'Join', toast: 'Saved' });
}
