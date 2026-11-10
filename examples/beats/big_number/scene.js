// Example beat on the REAL asset library: "forty seven percent" counts up on the word 'forty' and lands on 'percent'.
// Words 0..8 of examples/transcript.json (w0001..w0009).
export const meta = { title: 'big number' };

function params(rt) {
  const start = rt.at('w0007');            // 'forty': the count starts here
  const land = rt.at('w0009', 'end');      // end of 'percent.': the number has landed
  return {
    kicker: 'LAST YEAR', value: 47, suffix: '%', label: 'revenue growth', note: 'EXAMPLE DATA',
    countDur: land - start,
    at: { count: start, label: land, note: land + 0.1 },
  };
}

export function draw(rt, t) {
  rt.lib.draw('tech/big-stat', t, params(rt));
}

export function markers(rt) {
  return rt.lib.markers('tech/big-stat', params(rt));
}
