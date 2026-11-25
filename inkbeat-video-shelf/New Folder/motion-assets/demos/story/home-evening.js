/**
 * demos/story/home-evening.js — playable demo of 'story/home-evening'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/home-evening.js';

export const duration = 9;
export function demo(g, t) { assets['story/home-evening'].draw(g, t, {}); }
