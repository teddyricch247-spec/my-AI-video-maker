/**
 * demos/story/farm-field.js — playable demo of 'story/farm-field'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/farm-field.js';

export const duration = 10;
export function demo(g, t) { assets['story/farm-field'].draw(g, t, {}); }
