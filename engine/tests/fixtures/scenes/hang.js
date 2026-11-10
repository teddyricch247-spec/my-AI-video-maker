// Broken on purpose: never returns (watchdog test).
export function draw(rt, t) {
  if (t > 0.1) { for (;;) {} }
}
