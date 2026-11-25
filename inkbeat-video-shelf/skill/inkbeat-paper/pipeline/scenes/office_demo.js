// Mode 2 built-in demo: office presenter, live whiteboard plan writing, and typing developer.
// One scene file adapts automatically to 9:16 portrait beats and 16:9 calm editorial cuts via ctx.landscape.
import { assets as officeAssets } from '../../assets/story/office-day.js';
import { makeCam2d, calm2d, applyCam2d } from '../lib/cam2d.js';

export const words = [
  [0.2, 'Step'],
  [0.6, 'one:'],
  [1.2, 'sketch'],
  [1.9, 'the'],
  [2.3, 'plan'],
  [3.0, 'on'],
  [3.4, 'paper'],
  [4.3, 'test'],
  [4.9, 'early'],
  [5.8, 'before'],
  [6.4, 'you'],
  [7.1, 'ship'],
  [7.8, 'to'],
  [8.2, 'the'],
  [8.7, 'shelf.'],
];

export function build(ctx) {
  const params = {
    lines: ['Plan', '1  Draft', '2  Test', '3  Ship'],
    at: { write: 1.2, present: 1.6, point: 4.4, type: 0.6 },
    talk: { from: 1.4, to: 7.0 },
    time: 'day',
  };

  const beats = ctx.landscape
    ? calm2d([
        { at: 0.0, atPos: [640, 360], viewH: 720 },
        { at: 2.2, atPos: [560, 410], viewH: 600, zoom: 0.08 },
        { at: 7.1, atPos: [680, 390], viewH: 660 },
      ], { zoom: 0.08, every: 2 })
    : [
        { at: 0.0, atPos: [330, 445], viewH: 590 },
        { at: 1.3, atPos: [760, 355], viewH: 620, dur: 0.65 },
        { at: 3.0, atPos: [340, 445], viewH: 560, dur: 0.6 },
        { at: 4.9, atPos: [760, 355], viewH: 620, dur: 0.55 },
        { at: 7.3, atPos: [1085, 445], viewH: 580, dur: 0.55 },
      ];

  const cam = makeCam2d(beats, {
    drift: ctx.landscape ? 0 : 0.025,
    arc: ctx.landscape ? 0 : 8,
    fps: ctx.fps,
  });

  const sceneAsset = officeAssets['story/office-day'];
  return {
    update(g, t) {
      applyCam2d(g, cam(t), ctx);
      sceneAsset.draw(g, t, params);
    },
    markers() {
      return sceneAsset.markers(params);
    },
  };
}
