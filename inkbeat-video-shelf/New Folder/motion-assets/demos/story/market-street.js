/**
 * demos/story/market-street.js — playable demo of 'story/market-street'.
 * demo(g, t) draws the scene at time t (seconds, 0–15) with default params; demo.duration is the length of the beat.
 */
import { assets } from '../../assets/story/market-street.js';

export const duration = 8;
export function demo(g, t) { assets['story/market-street'].draw(g, t, {}); }
