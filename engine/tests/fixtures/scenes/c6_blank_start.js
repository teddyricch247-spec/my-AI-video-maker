// Broken on purpose (C6): nothing is drawn until t = 0.5.
export function draw(rt, t) {
  if (t < 0.5) return;
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.lib.draw('stub/label', t, { text: 'HELLO', x: 200, y: 160 });
}
