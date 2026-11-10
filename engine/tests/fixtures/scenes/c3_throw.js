// Broken on purpose (C3): throws once t > 1.
export function draw(rt, t) {
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.lib.draw('stub/label', t, { text: 'HELLO', x: 200, y: 160 });
  if (t > 1) throw new Error('boom at ' + t.toFixed(2));
}
