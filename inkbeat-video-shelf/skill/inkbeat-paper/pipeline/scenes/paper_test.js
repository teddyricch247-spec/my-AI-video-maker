// Minimal 2D smoke-test scene for doctor.py and quick camera-beat checks.
import { drawSky } from '../../assets/environment/sky.js';
import { drawHills, drawGround } from '../../assets/environment/terrain.js';
import { drawPlant } from '../../assets/environment/plants.js';
import { drawPerson } from '../../assets/people/rig.js';
import { character } from '../../assets/people/characters.js';
import { vignette, grainOver } from '../../assets/core/core.js';
import { makeCam2d, calm2d, applyCam2d } from '../lib/cam2d.js';

export const words = [
  [0.15, 'One'],
  [0.55, 'paper'],
  [1.05, 'beat'],
  [1.55, 'renders'],
  [2.10, 'clean'],
];

export function build(ctx) {
  const beats = ctx.landscape
    ? calm2d([
        { at: 0.0, atPos: [640, 360], viewH: 720 },
        { at: 1.5, atPos: [640, 390], viewH: 580, zoom: 0.08 },
      ], { zoom: 0.08, every: 2 })
    : [
        { at: 0.0, atPos: [640, 405], viewH: 600 },
        { at: 1.0, atPos: [640, 425], viewH: 480, dur: 0.65 },
        { at: 2.0, atPos: [640, 390], viewH: 560, dur: 0.65 },
      ];

  const cam = makeCam2d(beats, { drift: ctx.landscape ? 0 : 0.025, arc: ctx.landscape ? 0 : 10, fps: ctx.fps });

  const host = {
    ...character('office_woman'),
    x: 640,
    y: 590,
    s: 1.25,
    view: 'front',
    gestures: [
      { name: 'wave', at: 0.2, dur: 1.2, hand: 'R' },
      { name: 'thumbs_up', at: 1.5, dur: 1.4, hand: 'R' },
    ],
    talk: [[0.15, 2.5]],
    seed: 2,
  };

  return {
    update(g, t) {
      applyCam2d(g, cam(t), ctx);
      drawSky(g, t, { time: 'morning', cam: t * 14 });
      drawHills(g, t, { pal: 'warm', base: 430 });
      drawGround(g, t, { kind: 'grass', y: 550 });
      drawPlant(g, 'round_tree', t, { x: 420, y: 570, s: 1.0, seed: 3 });
      drawPlant(g, 'round_tree', t, { x: 860, y: 570, s: 0.95, seed: 7 });
      drawPerson(g, t, host);
      vignette(g, 0.2);
      grainOver(g, 0.35);
    },
    markers() {
      return [
        { id: 'wave', t: 0.3, kind: 'whoosh' },
        { id: 'thumbs', t: 1.8, kind: 'pop' },
      ];
    },
  };
}
