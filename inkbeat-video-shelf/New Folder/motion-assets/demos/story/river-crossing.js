/**
 * demos/story/river-crossing.js — playable demo of 'story/river-crossing'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/river-crossing.js';

export const duration = 10;
export function demo(g, t) { assets['story/river-crossing'].draw(g, t, {}); }
