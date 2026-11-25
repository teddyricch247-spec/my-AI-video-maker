/**
 * story/home-evening.js — 'story/home-evening'
 * A cosy living room in the evening: curtains, golden window, shelves, plant. A grandmother (headwrap) sits-reads... stands holding a paper and the child beside her
 * holds a mug; she reads, then presents it; the child gives a thumbs-up and smiles. Warm, quiet, family.
 *
 *   assets['story/home-evening'].draw(g, t, {});
 * params: at.read (0.8), at.present (4.2), at.thumbs (6.0)
 */
import { vignette, grainOver } from '../core/core.js';
import { drawInterior } from '../environment/interiors.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { smoke } from '../environment/weather-fx.js';
import { scene, pm } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { at: { read: .8, present: 4.2, thumbs: 6 } };
const people = p => [
  { ...character('elder_woman'), x: 500, y: 700, s: 1.9, view: 'front', seed: 2, gestures: [{ name: 'hold_paper', at: p.at.read, dur: 3.2 }, { name: 'present', at: p.at.present, dur: 2.4, hand: 'R', target: [820, 520] }], talk: { from: 4.3, to: 6.4 } },
  { ...character('child'), x: 800, y: 700, s: 1.7, view: 'front', seed: 4, props: [{ kind: 'mug', hand: 'L', col: '#F2B531' }], gestures: [{ name: 'thumbs_up', at: p.at.thumbs, dur: 2.4, hand: 'R' }], face: 'smile' },
];
export function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  drawInterior(g, t, { kind: 'living_room', time: 'golden' });
  // sofa
  g.fillStyle = '#8E5A4A'; g.beginPath(); g.roundRect(660, 470, 420, 170, 26); g.fill(); g.fillStyle = '#A5705A'; g.beginPath(); g.roundRect(680, 540, 380, 100, 20); g.fill(); g.fillStyle = '#6E4234'; g.fillRect(640, 560, 46, 90); g.fillRect(1056, 560, 46, 90);
  g.fillStyle = MUS(); g.beginPath(); g.roundRect(720, 520, 70, 60, 14); g.fill();
  const [A, B] = people(p);
  drawPerson(g, t, A); drawPerson(g, t, B);
  // table lamp glow
  g.fillStyle = 'rgba(255,214,140,.10)'; g.beginPath(); g.arc(360, 250, 220, 0, 7); g.fill();
  vignette(g, .3, '110,50,35'); grainOver(g, .4);
}
const MUS = () => '#F2B531';
export const assets = scene('story/home-evening', {
  title: 'Home evening', description: 'Cosy living room at golden hour: curtains, shelves, plant, sofa. A grandmother reads a paper and presents it while a child with a mug gives a thumbs-up. Use for family, home, learning at home, warm closing beats.', tags: ['home', 'evening', 'family', 'living room', 'cosy', 'reading', 'interior'],
  params: {}, anchors: { read: ANC(.8, 'grandmother starts reading'), present: ANC(4.2, 'grandmother presents the paper'), thumbs: ANC(6, 'child thumbs-up') }, markerKinds: ['rustle', 'whoosh', 'pop'], duration: 9, example: "assets['story/home-evening'].draw(g,t,{})"
}, draw, p => { const q = withDefaults(p, DEF); return pm(people(q)) });
