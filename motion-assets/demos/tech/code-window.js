/**
 * Demo for tech/code-window: Code window (typing, highlight, error) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './code-window.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-b.js';
export function demo(g, t) {
  assets['tech/code-window'].draw(g, t, { filename: 'main.py', lines: ['def total(items):', '    s = 0', '    for i in items:', '        s += i.price', '    return s', '# i.price can be None'], highlight: 3, error: 3, errorText: 'TypeError: NoneType + int' });
}
