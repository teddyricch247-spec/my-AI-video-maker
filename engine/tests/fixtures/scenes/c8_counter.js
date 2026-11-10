// Broken on purpose (C8): hidden module-level counter makes output depend on call history.
let calls = 0;
export function draw(rt, t) {
  calls++;
  rt.lib.draw('stub/pulse', t, { x: 980, y: 520, r: 70 });
  rt.lib.draw('stub/label', t, { text: 'HELLO', x: 200, y: 160 });
  rt.g.fillStyle = rt.palette.TOMATO;
  rt.g.fillRect(200 + (calls % 9) * 20, 300, 120, 80);
}
