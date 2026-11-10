/**
 * Demo for tech/phone-mock: Phone mock (notification, tap, swipe) with non-default params. demo(g, t) draws one frame (t in seconds, 1280x720 canvas).
 * Usage: import { demo } from './phone-mock.js'; demo(g, 2.5);
 */
import { assets } from '../../assets/technical/scenes-p1.js';
export function demo(g, t) {
  assets['tech/phone-mock'].draw(g, t, { appName: 'Shop', notifTitle: 'Order shipped', notifBody: 'Arrives Friday', detail: ['Shoes|-$89', 'Refund|+$12', 'Socks|-$9'] });
}
