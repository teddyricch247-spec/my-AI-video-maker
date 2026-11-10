// FIXTURE stub asset: idle motion, a pulsing disc.
import { MUSTARD } from '../core/palette.js';

export const assets = {
  'stub/pulse': {
    meta: { kind: 'idle', params: { x: 'number', y: 'number', r: 'number' } },
    draw(g, t, p) {
      const r = p.r + 10 * Math.sin((t * Math.PI * 2) / 1.5);
      g.fillStyle = p.color || MUSTARD;
      g.beginPath();
      g.arc(p.x + 25 * Math.sin(t * 1.3), p.y, r, 0, Math.PI * 2);
      g.fill();
    },
  },
};
