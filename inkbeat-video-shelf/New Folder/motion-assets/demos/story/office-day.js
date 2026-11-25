/**
 * demos/story/office-day.js — playable demo of 'story/office-day'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/office-day.js';

export const duration = 10;
export function demo(g, t) { assets['story/office-day'].draw(g, t, {}); }
