// Broken on purpose (C5): two different texts drawn on top of each other.
export function draw(rt, t) {
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.core.txt(rt.g, 'HELLO', 200, 160, { size: 56 });
  rt.core.txt(rt.g, 'WORLD', 215, 170, { size: 56 });
}
