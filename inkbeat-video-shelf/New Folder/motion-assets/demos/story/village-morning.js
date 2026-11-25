/**
 * demos/story/village-morning.js — playable demo of 'story/village-morning'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/village-morning.js';

export const duration = 9;
export function demo(g, t) { assets['story/village-morning'].draw(g, t, {}); }
