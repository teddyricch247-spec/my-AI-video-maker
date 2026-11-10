// Broken on purpose (C4): text runs off the right edge.
export function draw(rt, t) {
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.core.txt(rt.g, 'HELLO', 1200, 160, { size: 48 });
}
