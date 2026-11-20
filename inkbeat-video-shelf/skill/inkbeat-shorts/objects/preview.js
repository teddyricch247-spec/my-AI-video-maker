// node objects/preview.js [--out objects/previews] [--cell 360]   -> labelled contact sheets of the prebuilt characters (PNG). LOOK at them.
// Needs only node + Playwright + ffmpeg (no Python imaging libs). Renders cells with pipeline/render.js (scene _charsheet), tiles with ffmpeg.
const cp = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), a = Object.fromEntries(process.argv.slice(2).reduce((r, x, i, v) => x.startsWith('--') ? [...r, [x.slice(2), v[i + 1]]] : r, []));
const OUT = path.resolve(a.out || path.join(__dirname, 'previews')), CW = +(a.cell || 360), CH = Math.round(CW * 16 / 9), tmp = path.join(OUT, '_cells');
fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const FONT = path.join(root, 'pipeline/fonts/Poppins-ExtraBold.ttf');
let n = 0;
function cell(label, q, h = CH, w = CW, scene = '_charsheet') { // render one cell, return {file,label}
  const dir = path.join(tmp, 'c' + String(++n).padStart(3, '0'));
  const r = cp.spawnSync('node', [path.join(root, 'pipeline/render.js'), '--scene', scene, '--frames', '0-0', '--w', w, '--h', h, '--out', dir, '--q', q], { encoding: 'utf8' });
  if (r.status || /FATAL|PAGEERR/.test(r.stdout)) { console.log(r.stdout, r.stderr); process.exit(1); }
  return { file: path.join(dir, '0000.jpg'), label };
}
function sheet(name, cells, cols, w = CW, h = CH) {
  const rows = Math.ceil(cells.length / cols), list = path.join(tmp, name + '.txt');
  const ls = cells.map((c, i) => { const f = path.join(tmp, `${name}_${String(i).padStart(2, '0')}.png`);
    const esc = c.label.replace(/[:\\']/g, '');
    const vf = `drawbox=x=0:y=ih-${Math.round(w * 0.12)}:w=iw:h=${Math.round(w * 0.12)}:color=0x2a1442@0.85:t=fill,drawtext=fontfile=${FONT}:text='${esc}':fontcolor=white:fontsize=${Math.round(w * 0.056)}:x=(w-text_w)/2:y=h-${Math.round(w * 0.085)}`;
    const r = cp.spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', c.file, '-vf', vf, f]); if (r.status) { console.log(String(r.stderr)); process.exit(1); } return f; });
  const args = ['-y', '-v', 'error', ...ls.flatMap((f) => ['-i', f]), '-filter_complex', ls.map((_, i) => `[${i}:v]`).join('') + `xstack=inputs=${ls.length}:layout=` +
    ls.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join('|') + ':fill=0x2a1442', path.join(OUT, name + '.png')];
  const r = cp.spawnSync('ffmpeg', args); if (r.status) { console.log(String(r.stderr)); process.exit(1); } console.log('wrote', path.join(OUT, name + '.png'), `(${cells.length} cells)`);
}
const CAST = ['sam', 'ada', 'kid', 'elder'];
// 1. cast lineup
sheet('cast', CAST.map((w) => cell(w, `who=${w}&cam=front`)), 4);
// 2. turnaround: front / 3-4 / side / back for sam + ada
sheet('turnaround', ['sam', 'ada'].flatMap((w) => ['front', 'three', 'side', 'back'].map((c) => cell(`${w} ${c === 'three' ? '3/4' : c}`, `who=${w}&cam=${c}`))), 4);
// 3. faces: the six expressions on sam and ada (+ talk)
const EX = ['neutral', 'happy', 'shocked', 'sad', 'angry', 'worried'];
sheet('faces', ['sam', 'ada'].flatMap((w) => EX.map((e) => cell(`${w} ${e}`, `who=${w}&expr=${e}&cam=face`, CW, CW))), 6, CW, CW);
// 4. acts (sam, 3/4 view at a mid-cycle moment)
const ACTS = [['idle', 'idle', 0], ['walk', 'walk', 0.25], ['run', 'run', 0.2], ['wave', 'wave', 0.6], ['point', 'point', 0], ['talk', 'talk', 0.5], ['react', 'react', 0.55], ['sit', 'sit', 0], ['plant', 'plant', 0.3], ['dig', 'dig', 0.55, 'shovel'], ['dig 2', 'dig', 1.3, 'shovel'], ['hold', 'hold', 0, 'shovel']];
sheet('acts', ACTS.map(([l, act, t, prop]) => cell(l, `who=sam&acts=${act}&t=${t}&cam=three${prop ? '&prop=' + prop : ''}`)), 4);

// 5. props: car (4 views, colours, crash) and tree (styles, growth, sway)
const P = (l, q, w = CW, h = CW) => cell(l, q, h, w, '_propsheet');
sheet('car', [P('car front', 'what=car&cam=front'), P('car 3/4', 'what=car&cam=three'), P('car side', 'what=car&cam=side'), P('car back', 'what=car&cam=back'),
  ...['yellow', 'blue', 'green', 'white'].map((c) => P(c, `what=car&cam=three&color=${c}`)), P('crash 0.1s', 'what=car&crash=0.1'), P('crash 0.4s', 'what=car&crash=0.4'), P('crash 1.0s', 'what=car&crash=1.0'), P('crash 1.6s', 'what=car&crash=1.6')], 4, CW, CW);
sheet('tree', [...['round', 'autumn', 'tall'].map((s) => P(s, `what=tree&style=${s}`)), P('sapling 0.2', 'what=tree&grow=0.2'), P('sway 0.1s', 'what=tree&hit=0.1'), P('leaves 0.6s', 'what=tree&hit=0.6'), P('leaves 1.8s', 'what=tree&hit=1.8')], 4, CW, CW);
fs.rmSync(tmp, { recursive: true, force: true });
