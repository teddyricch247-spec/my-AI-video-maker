// Broken on purpose (C1): uses Math.random. The value is unused so no other check can fire.
export function draw(rt, t) {
  void Math.random();
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.lib.draw('stub/label', t, { text: 'HELLO', x: 200, y: 160 });
}
