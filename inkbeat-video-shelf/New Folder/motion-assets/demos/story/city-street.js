/**
 * demos/story/city-street.js — playable demo of 'story/city-street'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/city-street.js';

export const duration = 9;
export function demo(g, t) { assets['story/city-street'].draw(g, t, {}); }
