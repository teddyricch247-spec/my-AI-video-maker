// Broken on purpose (C7): perfectly static for the whole beat.
export function draw(rt, t) {
  rt.g.fillStyle = rt.palette.TOMATO;
  rt.g.fillRect(200, 260, 360, 160);
  rt.g.fillStyle = rt.palette.MUSTARD;
  rt.g.beginPath(); rt.g.arc(980, 520, 70, 0, Math.PI * 2); rt.g.fill();
  rt.core.txt(rt.g, 'STATIC', 200, 160, { size: 56 });
}
