const http = require('http');
const fs = require('fs');
const path = require('path');

// node render.js --scene city_demo --frames 0-59 --w 720 --h 1280 --out /tmp/inkbeat-renders/run1
// External scene outside codebase: --scene-file /tmp/inkbeat-work/story.js
// Optional marker export: --dump-markers /tmp/inkbeat-renders/run1/markers.json

function loadPW() {
  const cp = require('child_process');
  let g = '';
  try { g = cp.execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
  for (const m of ['playwright', 'playwright-core', '/opt/npm-tools/node_modules/playwright', g && g + '/playwright', g && g + '/playwright-core'].filter(Boolean)) {
    try { return require(m); } catch (e) {}
  }
  console.log('FATAL: no playwright module. Run:  npm i -D playwright-core   (or bun add -d playwright-core)');
  process.exit(3);
}

const { chromium } = loadPW();

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = ['/ms-playwright', '/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH, require('os').homedir() + '/.cache/ms-playwright'].filter(Boolean);
  const want = ['chrome-headless-shell', 'chrome'];
  for (const r of roots) {
    try {
      for (const d of fs.readdirSync(r)) {
        const base = path.join(r, d);
        for (const sub of ['', ...fs.readdirSync(base).filter((x) => /linux/.test(x))]) {
          for (const w of want) {
            const f = path.join(base, sub, w);
            if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
          }
        }
      }
    } catch (e) {}
  }
  return undefined;
}

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const a = Object.fromEntries(process.argv.slice(2).reduce((r, x, i, v) => (x.startsWith('--') ? [...r, [x.slice(2), v[i + 1]]] : r), []));
const [f0, f1] = (a.frames || '0-0').split('-').map(Number);
const w = +a.w || 720, h = +a.h || 1280, fps = +a.fps || 30, out = a.out || '/tmp/inkbeat-renders/run';
const sceneFile = a['scene-file'] ? path.resolve(a['scene-file']) : null;
const scene = sceneFile ? '_active_scene' : (a.scene || 'city_demo');
const frameList = a['frames-list']
  ? a['frames-list'].split(',').map(Number).filter(Number.isFinite)
  : Array.from({ length: Math.max(0, f1 - f0 + 1) }, (_, i) => f0 + i);

fs.mkdirSync(out, { recursive: true });
const root = path.join(__dirname, '..');
const wordsFile = a.words;

const srv = http.createServer((q, s) => {
  const reqPath = decodeURIComponent(q.url.split('?')[0]);
  if (wordsFile && reqPath === '/words.json') {
    s.writeHead(200, { 'content-type': 'application/json' });
    return s.end(fs.readFileSync(wordsFile));
  }
  if (sceneFile && reqPath === '/pipeline/scenes/_active_scene.js') {
    s.writeHead(200, { 'content-type': 'text/javascript' });
    return s.end(fs.readFileSync(sceneFile));
  }
  const p = path.resolve(root, '.' + reqPath);
  if (!p.startsWith(root)) {
    s.writeHead(403);
    s.end();
    return;
  }
  fs.readFile(p, (e, d) => {
    if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    s.end(d);
  });
});

srv.listen(0, async () => {
  const port = srv.address().port;
  const b = await chromium.launch({ executablePath: findChrome() });
  const pg = await b.newPage();
  let fatalErr = null;
  pg.on('pageerror', (e) => {
    console.log('PAGEERR', e.message);
    fatalErr = e.message;
  });
  pg.on('console', (m) => {
    const t = m.text();
    console.log('CONSOLE', t.slice(0, 400));
    if (m.type() === 'error') fatalErr = t;
  });

  const url = `http://localhost:${port}/pipeline/page.html?scene=${scene}&w=${w}&h=${h}&fps=${fps}&sub=${a.sub || 1}${wordsFile ? '&words=1' : ''}${a.caps ? '&caps=' + a.caps : ''}${a.capscale ? '&capscale=' + a.capscale : ''}${a.accent ? '&accent=' + encodeURIComponent(a.accent) : ''}`;
  try {
    await pg.goto(url);
    await pg.waitForFunction('window.READY', null, { timeout: 60000 });
  } catch (e) {
    console.log('FATAL:', fatalErr || e.message);
    await b.close();
    srv.close();
    process.exit(2);
  }

  if (a['dump-markers']) {
    const markers = await pg.evaluate(() => (window.getMarkers ? window.getMarkers() : []));
    fs.writeFileSync(a['dump-markers'], JSON.stringify(markers, null, 2));
  }

  const t0 = Date.now();
  let n = 0;
  for (const f of frameList) {
    const fn = path.join(out, String(f).padStart(4, '0') + '.jpg');
    if (fs.existsSync(fn)) continue;
    const d = await pg.evaluate((frameIdx) => window.renderFrame(frameIdx), f);
    fs.writeFileSync(fn, Buffer.from(d.split(',')[1], 'base64'));
    n++;
  }
  if (fatalErr) {
    console.log('FATAL:', fatalErr);
    await b.close();
    srv.close();
    process.exit(2);
  }
  console.log(`rendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s (${n ? ((Date.now() - t0) / n / 1000).toFixed(2) : 0}s/frame) at ${w}x${h}`);
  await b.close();
  srv.close();
});
