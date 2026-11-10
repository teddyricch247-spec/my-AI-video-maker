// FIXTURE stub asset: a text label built on core.txt.
import { txt, A } from '../core/core.js';
import { INK } from '../core/palette.js';

export const assets = {
  'stub/label': {
    meta: { kind: 'text', params: { text: 'string', x: 'number', y: 'number' } },
    draw(g, t, p) {
      txt(g, p.text, p.x, p.y, { size: p.size || 56, color: p.color || INK, alpha: A(t, p.delay || 0, 0.25) });
    },
  },
};
