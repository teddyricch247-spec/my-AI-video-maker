/**
 * palette.js - FROZEN CORE API. Palette, canvas size and font stacks (values copied from v2.html).
 * Exports: W, H (1280x720 logical canvas), INK, PAPER, TOMATO, MUSTARD, GREEN, PINK, SHADOW, AQUA, LEAF, CREAM, SERIF, SANS, MONO.
 * Usage:
 *   import { INK, PAPER, W, H } from '../core/palette.js';
 *   g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
 *   g.fillStyle = INK;
 */
export const W = 1280, H = 720;
export const SERIF = 'Lora, Georgia, serif', MONO = '"DejaVu Sans Mono", monospace', SANS = 'Poppins, Inter, sans-serif';
export const INK = '#221E1A', PAPER = '#F3EAD7', TOMATO = '#E8452C', MUSTARD = '#F2B531', GREEN = '#2F7D5B', PINK = '#F2A3B5',
  SHADOW = '#CDBE9F', AQUA = '#CFE6DC', LEAF = '#CFE3B8', CREAM = '#FBF3E2';
