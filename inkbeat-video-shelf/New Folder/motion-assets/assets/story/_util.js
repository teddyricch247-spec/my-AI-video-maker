/** Internal helpers for story scenes (not an asset). */
import { travelDist } from '../people/locomotion.js';
import { personMarkers } from '../people/rig.js';
import { mk } from '../environment/_meta.js';

/** x0 so that a person walking in direction dir at `speed` and easing to rest at `stop` ends at toX */
export function walkFrom(toX, dir, speed, stop, from = null) { const D = travelDist(stop + 3, { speed, from, to: stop }); return toX - dir * D }
/** scene registration shortcut */
export function scene(id, o, draw, markers) { return { [id]: mk(id, { kind: 'scene', mode: 'story', duration: 10, bounds: [0, 0, 1280, 720], origin: [0, 0], ...o }, draw, markers) } }
export const pm = (list, tMax = 15) => list.flatMap((o, i) => personMarkers(o, tMax).map(m => ({ ...m, id: `p${i}-${m.id}` })));
/** sort people back-to-front by ground y */
export const byY = list => [...list].sort((a, b) => a.y - b.y);
