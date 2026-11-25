/**
 * demos/story/desert-dunes.js — playable demo of 'story/desert-dunes'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/desert-dunes.js';

export const duration = 8;
export function demo(g, t) { assets['story/desert-dunes'].draw(g, t, {}); }
