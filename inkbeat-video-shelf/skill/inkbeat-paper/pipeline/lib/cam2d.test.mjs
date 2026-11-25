import test from 'node:test';
import assert from 'node:assert/strict';
import { cl, lerp, eo, eio, shade, rng, tiled } from '../../assets/core/core.js';
import { makeCam2d, calm2d, clampPoseToStage } from './cam2d.js';

test('core math and deterministic utilities produce pure repeatable outputs', () => {
  assert.equal(cl(1.5), 1);
  assert.equal(cl(-2, 1, 5), 1);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(eo(0), 0);
  assert.equal(eo(1), 1);
  assert.equal(eio(0.5), 0.5);

  assert.equal(shade('#804020', 0), '#804020');
  assert.equal(shade('#804020', -0.5), '#402010');

  const r1 = rng(123);
  const r2 = rng(123);
  assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);

  const hits = [];
  tiled(500, 120, (ox, k) => hits.push([ox, k]), 0);
  assert.ok(hits.length >= 2);
  assert.equal(hits[0][0], hits[0][1] * 500 - 120);
});

test('makeCam2d and calm2d compute pure deterministic camera poses and stage clamps', () => {
  const beats = [
    { at: 0, atPos: [340, 440], viewH: 580 },
    { at: 2.0, atPos: [760, 390], viewH: 540, dur: 0.6 },
  ];

  const camPortrait = makeCam2d(beats, { drift: 0.025, arc: 8, fps: 30 });
  assert.deepEqual(camPortrait(1.0), camPortrait(1.0));
  const pEnd = camPortrait(3.0);
  assert.ok(Math.abs(pEnd.cx - 760) < 15);
  assert.ok(pEnd.viewH < 540);

  const camCalm = makeCam2d(calm2d(beats, { zoom: 0.08, every: 2 }), { drift: 0, arc: 0, fps: 30 });
  const beforeCut = camCalm(1.9);
  const afterCut = camCalm(2.05);
  assert.equal(beforeCut.cx, 340);
  assert.equal(afterCut.cx, 760);

  const clamped = clampPoseToStage({ cx: 40, cy: 10, viewH: 720, roll: 0 }, { w: 1080, h: 1920 });
  assert.ok(clamped.cx >= 200);
  assert.ok(clamped.cy >= 360);
});
