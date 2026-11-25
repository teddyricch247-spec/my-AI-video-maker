/**
 * demos/story/bus-stop-wait.js — playable demo of 'story/bus-stop-wait'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/bus-stop-wait.js';

export const duration = 10;
export function demo(g, t) { assets['story/bus-stop-wait'].draw(g, t, {}); }
