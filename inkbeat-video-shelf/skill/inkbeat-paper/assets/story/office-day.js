/**
 * story/office-day.js — 'story/office-day'
 * An office: backdrop with windows, clock and posters; a whiteboard that writes a plan; two colleagues seen from the front behind their desks
 * (half-body people with desks drawn in front of them). The office woman presents toward the whiteboard then points at it; the developer types.
 *
 *   assets['story/office-day'].draw(g, t, {lines:['Plan','1  Draft','2  Test','3  Ship']});
 * params: lines (whiteboard text), at.write (1.2), at.present (1.6), at.point (4.4), at.type (0.6), talk {from,to}
 */
import { vignette, grainOver } from '../core/core.js';
import { drawInterior, drawDesk, drawWhiteboard, drawChair } from '../environment/interiors.js';
import { drawPlant } from '../environment/plants.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { scene, pm } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { lines: ['Plan', '1  Draft', '2  Test', '3  Ship'], at: { write: 1.2, present: 1.6, point: 4.4, type: .6 }, talk: { from: 1.6, to: 6.4 }, time: 'day' };
const WB = { x: 760, y: 330, w: 330, h: 200 };
const people = p => [
  { ...character('office_woman'), x: 330, y: 800, s: 2.1, view: 'front', half: true, seed: 3, talk: p.talk, gestures: [{ name: 'present', at: p.at.present, dur: 2.6, hand: 'R', target: [WB.x - 120, WB.y] }, { name: 'point_at', at: p.at.point, dur: 2.4, hand: 'R', target: [WB.x - 40, WB.y + 20] }, { name: 'shrug', at: 7.6, dur: 2 }] },
  { ...character('developer'), x: 1090, y: 800, s: 1.95, view: 'front', half: true, seed: 8, gestures: [{ name: 'type_on_laptop', at: p.at.type, dur: 6.5 }, { name: 'thumbs_up', at: 7.4, dur: 2.2, hand: 'R' }] },
];
export function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  drawInterior(g, t, { kind: 'office', time: p.time });
  drawWhiteboard(g, t, { ...WB, lines: p.lines, at: { write: p.at.write }, chart: true });
  const [A, B] = people(p);
  drawPerson(g, t, A); drawDesk(g, t, { x: 330, y: 740, w: 340, mug: true, papers: true }); 
  drawPerson(g, t, B); drawDesk(g, t, { x: 1090, y: 740, w: 300, monitor: false });
  drawPlant(g, 'potted', t, { x: 600, y: 640, s: 1.2 });
  vignette(g, .18); grainOver(g, .4);
}
export const assets = scene('story/office-day', {
  title: 'Office day', description: 'Office interior with windows, clock, posters and a whiteboard that writes a plan; a woman presents and points at the whiteboard while a colleague types at a laptop. Use for planning, teamwork, work-life and explainer beats set at work.', tags: ['office', 'interior', 'work', 'presentation', 'whiteboard', 'team', 'laptop'],
  params: { lines: P('array', ['Plan', '1  Draft', '2  Test', '3  Ship'], 'whiteboard lines'), time: P('string', 'day', 'window light: day|golden|night'), talk: P('object', { from: 1.6, to: 6.4 }, 'mouth moves for the presenter') }, anchors: { write: ANC(1.2, 'whiteboard starts writing'), present: ANC(1.6, 'presenter gestures at the board'), point: ANC(4.4, 'presenter points'), type: ANC(.6, 'developer starts typing') }, markerKinds: ['rustle', 'tick', 'whoosh', 'pop'], duration: 10, example: "assets['story/office-day'].draw(g,t,{lines:['Goals','Q1','Q2']})"
}, draw, p => { const q = withDefaults(p, DEF); return [...q.lines.map((l, i) => ({ id: 'wb' + i, t: q.at.write + i * .8, kind: 'rustle' })), ...pm(people(q))] });
