import test from 'node:test';
import assert from 'node:assert/strict';
import { groupVideosIntoFolders, isSafeVideoPath, parseVideoEntry } from './folders.js';

test('parseVideoEntry groups multi-part and nested part filenames into session folders', () => {
  const a = parseVideoEntry({ name: 'warehouse-part1.mp4', size: 1000, created: '2026-11-24T14:23:04Z' });
  const b = parseVideoEntry({ name: 'lighthouse-part3-part-02.mp4', size: 2000, created: '2026-11-23T18:49:14Z' });
  const c = parseVideoEntry({ name: 'decompression-zone-part4.mp4', size: 3000, created: '2026-11-24T13:44:16Z' });
  const d = parseVideoEntry({ name: 'my-story-16x9-part-01.mp4', size: 4000, created: '2026-11-25T10:00:00Z' });
  const e = parseVideoEntry({ name: 'session-alpha/intro.mp4', size: 5000, created: '2026-11-25T11:00:00Z' });

  assert.equal(a.folderSlug, 'warehouse');
  assert.equal(a.folderTitle, 'Warehouse');
  assert.equal(a.partLabel, 'Part 1');
  assert.deepEqual(a.partOrder, [1]);

  assert.equal(b.folderSlug, 'lighthouse');
  assert.equal(b.folderTitle, 'Lighthouse');
  assert.equal(b.partLabel, 'Part 3.2');
  assert.deepEqual(b.partOrder, [3, 2]);

  assert.equal(c.folderSlug, 'decompression-zone');
  assert.equal(c.folderTitle, 'Decompression Zone');
  assert.equal(c.partLabel, 'Part 4');

  assert.equal(d.folderSlug, 'my-story');
  assert.equal(d.wide, true);
  assert.equal(d.aspect, '16:9');
  assert.equal(d.partLabel, 'Part 1');

  assert.equal(e.folderSlug, 'session-alpha');
  assert.equal(e.folderTitle, 'Session Alpha');
  assert.equal(e.partLabel, 'Intro');
});

test('groupVideosIntoFolders sorts folders newest-first and parts ascending', () => {
  const sample = [
    { name: 'target-fixation-part-02.mp4', size: 100, created: '2026-11-20T09:33:44Z' },
    { name: 'target-fixation-part-01.mp4', size: 100, created: '2026-11-20T09:33:43Z' },
    { name: 'warehouse-part4.mp4', size: 200, created: '2026-11-24T19:51:31Z' },
    { name: 'warehouse-part1.mp4', size: 300, created: '2026-11-24T14:23:04Z' },
    { name: 'lighthouse-part3-part-02.mp4', size: 150, created: '2026-11-23T18:49:14Z' },
    { name: 'lighthouse-part3-part-01.mp4', size: 120, created: '2026-11-23T18:49:12Z' },
    { name: 'lighthouse-part1.mp4', size: 180, created: '2026-11-23T18:49:08Z' },
  ];

  const folders = groupVideosIntoFolders(sample);
  assert.deepEqual(
    folders.map((f) => f.slug),
    ['warehouse', 'lighthouse', 'target-fixation']
  );

  assert.deepEqual(
    folders[0].videos.map((v) => v.name),
    ['warehouse-part1.mp4', 'warehouse-part4.mp4']
  );
  assert.equal(folders[0].totalBytes, 500);
  assert.equal(folders[0].clipCount, 2);

  assert.deepEqual(
    folders[1].videos.map((v) => v.name),
    ['lighthouse-part1.mp4', 'lighthouse-part3-part-01.mp4', 'lighthouse-part3-part-02.mp4']
  );

  assert.deepEqual(
    folders[2].videos.map((v) => v.name),
    ['target-fixation-part-01.mp4', 'target-fixation-part-02.mp4']
  );
});

test('isSafeVideoPath accepts valid video paths and rejects traversal or non-videos', () => {
  assert.equal(isSafeVideoPath('warehouse-part1.mp4'), true);
  assert.equal(isSafeVideoPath('my-session/part-01.mp4'), true);
  assert.equal(isSafeVideoPath('../secret.mp4'), false);
  assert.equal(isSafeVideoPath('/warehouse-part1.mp4'), false);
  assert.equal(isSafeVideoPath('warehouse-part1.txt'), false);
  assert.equal(isSafeVideoPath(''), false);
});

test('parseVideoEntry detects Mode 2 paper style and strips -paper/-2d tags from session slugs', () => {
  const p1 = parseVideoEntry({ name: 'office-plan-paper-part-01.mp4', size: 1200, created: '2026-11-25T12:00:00Z' });
  const p2 = parseVideoEntry({ name: 'office-plan-paper-16x9-part-02.mp4', size: 1400, created: '2026-11-25T12:01:00Z' });
  const p3 = parseVideoEntry({ name: 'warehouse-part1.mp4', size: 1000, created: '2026-11-24T12:00:00Z' });

  assert.equal(p1.style, 'paper');
  assert.equal(p1.styleLabel, '2D Paper');
  assert.equal(p1.folderSlug, 'office-plan');
  assert.equal(p1.partLabel, 'Part 1');
  assert.equal(p1.wide, false);

  assert.equal(p2.style, 'paper');
  assert.equal(p2.wide, true);
  assert.equal(p2.aspect, '16:9');
  assert.equal(p2.folderSlug, 'office-plan');
  assert.equal(p2.partLabel, 'Part 2');

  assert.equal(p3.style, '3d');
  assert.equal(p3.styleLabel, '3D Cartoon');

  const folders = groupVideosIntoFolders([p1, p2, p3]);
  assert.deepEqual(folders[0].styles, ['paper']);
  assert.deepEqual(folders[1].styles, ['3d']);
});

