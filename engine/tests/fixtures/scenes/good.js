// Good fixture scene: word-anchored box, a label, idle motion, a marker. No findings expected.
export const meta = { title: 'good fixture' };

export function draw(rt, t) {
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.lib.draw('stub/label', t, { text: 'HELLO', x: 200, y: 160 });
  rt.lib.draw('stub/box', t, { x: 200, y: 260, w: 360, h: 160, at: { start: rt.at('w0003') } });
  if (rt.param('useMedia', false)) {
    rt.core.txt(rt.g, 'img', 700, 120, { size: 28 });
    rt.g.drawImage(rt.media('img1'), 640, 160, 64, 64);
  }
}

export function markers(rt) {
  return [{ id: 'm1', t: rt.at('w0003'), kind: 'pop' }];
}
