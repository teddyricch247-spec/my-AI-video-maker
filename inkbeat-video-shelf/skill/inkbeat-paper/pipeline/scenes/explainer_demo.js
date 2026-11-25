// Starter template to copy to /tmp/inkbeat-work/<slug>.js for custom Mode 2 (2D Paper Motion) stories.
// Demonstrates mixing individual modular assets: sky, interior/ground, furniture, whiteboard, and custom characters + gestures.
import { drawInterior, drawDesk, drawWhiteboard } from '../../assets/environment/interiors.js';
import { drawPlant } from '../../assets/environment/plants.js';
import { drawPerson, personMarkers } from '../../assets/people/rig.js';
import { character } from '../../assets/people/characters.js';
import { vignette, grainOver } from '../../assets/core/core.js';
import { makeCam2d, calm2d, applyCam2d } from '../lib/cam2d.js';

export const words = [
  [0.2, 'Most'],
  [0.6, 'teams'],
  [1.1, 'skip'],
  [1.6, 'the'],
  [1.9, 'first'],
  [2.4, 'draft'],
  [3.2, 'check'],
  [4.0, 'and'],
  [4.4, 'pay'],
  [4.9, 'later.'],
];

export function build(ctx) {
  const host = {
    ...character('student'),
    x: 430,
    y: 785,
    s: 2.0,
    view: 'front',
    half: true,
    seed: 12,
    talk: [[0.2, 5.2]],
    gestures: [
      { name: 'count_fingers', at: 0.4, dur: 2.2, hand: 'R', n: 3 },
      { name: 'point_at', at: 2.8, dur: 1.6, hand: 'L', target: [840, 320] },
      { name: 'thumbs_up', at: 4.5, dur: 1.4, hand: 'R' },
    ],
  };

  const wb = {
    x: 840,
    y: 320,
    w: 320,
    h: 195,
    lines: ['Rule of 3', '1  Hook fast', '2  Show clearly', '3  End clean'],
    speed: 0.75,
    chart: true,
    at: { write: 1.0 },
  };

  const beats = ctx.landscape
    ? calm2d([
        { at: 0.0, atPos: [640, 360], viewH: 720 },
        { at: 2.6, atPos: [620, 400], viewH: 600, zoom: 0.08 },
      ], { zoom: 0.08, every: 2 })
    : [
        { at: 0.0, atPos: [430, 445], viewH: 590 },
        { at: 1.4, atPos: [840, 350], viewH: 610, dur: 0.6 },
        { at: 3.0, atPos: [840, 355], viewH: 610, dur: 0.45 },
        { at: 4.4, atPos: [430, 445], viewH: 560, dur: 0.55 },
      ];

  const cam = makeCam2d(beats, {
    drift: ctx.landscape ? 0 : 0.025,
    arc: ctx.landscape ? 0 : 8,
    fps: ctx.fps,
  });

  return {
    update(g, t) {
      applyCam2d(g, cam(t), ctx);
      drawInterior(g, t, { kind: 'classroom', time: 'day' });
      drawWhiteboard(g, t, wb);
      drawPerson(g, t, host);
      drawDesk(g, t, { x: 430, y: 735, w: 320, mug: true, papers: true });
      drawPlant(g, 'potted', t, { x: 1130, y: 620, s: 1.2 });
      vignette(g, 0.18);
      grainOver(g, 0.35);
    },
    markers() {
      return [
        ...wb.lines.map((_, i) => ({ id: `wb-${i}`, t: wb.at.write + i * wb.speed, kind: 'rustle' })),
        ...personMarkers(host, 8),
      ];
    },
  };
}
