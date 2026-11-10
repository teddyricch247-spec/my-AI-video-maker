// FIXTURE stub asset: a rect that animates in at params.at.start (beat-local seconds).
import { eo, A, rrect } from '../core/core.js';
import { TOMATO } from '../core/palette.js';

export const assets = {
  'stub/box': {
    meta: { kind: 'shape', params: { x: 'number', y: 'number', w: 'number', h: 'number', at: '{start:number}' } },
    draw(g, t, p) {
      const k = eo(A(t, p.at.start, 0.3));
      if (k <= 0) return;
      g.fillStyle = p.color || TOMATO;
      rrect(g, p.x, p.y, p.w * k, p.h, 12);
      g.fill();
    },
    markers(p) { return [{ id: 'box-pop', t: p.at.start, kind: 'pop' }]; },
  },
};
