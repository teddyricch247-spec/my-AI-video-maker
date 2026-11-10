// Broken on purpose (C2): console.error from draw.
export function draw(rt, t) {
  console.error('scene complains');
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.lib.draw('stub/label', t, { text: 'HELLO', x: 200, y: 160 });
}
