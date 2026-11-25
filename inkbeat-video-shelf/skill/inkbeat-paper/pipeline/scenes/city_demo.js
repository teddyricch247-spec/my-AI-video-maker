// Mode 2 built-in demo: city street with bus, taxi, crowd, and waving delivery rider.
// Works in both 9:16 (portrait camera beats tracking the rider & street) and 16:9 (calm master/medium cuts).
import { assets as cityAssets } from '../../assets/story/city-street.js';
import { makeCam2d, calm2d, applyCam2d } from '../lib/cam2d.js';

export const words = [
  [0.2, 'Busy'],
  [0.7, 'city'],
  [1.2, 'morning'],
  [2.1, 'rush'],
  [3.0, 'bus'],
  [3.6, 'rolls'],
  [4.3, 'then'],
  [4.8, 'our'],
  [5.4, 'rider'],
  [6.3, 'checks'],
  [6.9, 'in'],
  [7.6, 'all'],
  [8.1, 'good!'],
];

export function build(ctx) {
  const params = { time: 'noon', crowd: 24, at: { bus: 0.5, wave: 4.2, thumbs: 6.6 } };
  const beats = ctx.landscape
    ? calm2d([
        { at: 0.0, atPos: [640, 360], viewH: 720 },
        { at: 3.4, atPos: [730, 430], viewH: 580, zoom: 0.08 },
        { at: 6.4, atPos: [640, 360], viewH: 720 },
      ], { zoom: 0.08, every: 2 })
    : [
        { at: 0.0, atPos: [420, 420], viewH: 680 },
        { at: 1.6, atPos: [620, 440], viewH: 620, dur: 0.7 },
        { at: 3.2, atPos: [820, 460], viewH: 580, dur: 0.7 },
        { at: 4.2, atPos: [760, 470], viewH: 520, dur: 0.6 },
        { at: 6.6, atPos: [760, 465], viewH: 480, dur: 0.55 },
      ];

  const cam = makeCam2d(beats, {
    drift: ctx.landscape ? 0 : 0.025,
    arc: ctx.landscape ? 0 : 8,
    fps: ctx.fps,
  });

  const sceneAsset = cityAssets['story/city-street'];
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
