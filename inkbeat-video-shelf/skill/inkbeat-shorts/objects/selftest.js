// node objects/selftest.js : headless-browser self-test of objects/character.js (+ static scan for Math.random/Date). Exit code 1 on failure.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
function loadPW() { const cp = require('child_process'); let g = ''; try { g = cp.execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
  for (const m of ['playwright', 'playwright-core', '/opt/npm-tools/node_modules/playwright', g && g + '/playwright', g && g + '/playwright-core'].filter(Boolean)) { try { return require(m); } catch (e) {} }
  console.log('FATAL: no playwright module'); process.exit(3); }
function findChrome() { if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const r of ['/ms-playwright', '/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH, require('os').homedir() + '/.cache/ms-playwright'].filter(Boolean)) { try { for (const d of fs.readdirSync(r)) { const base = path.join(r, d); for (const sub of ['', ...fs.readdirSync(base).filter((x) => /linux/.test(x))]) for (const w of ['chrome-headless-shell', 'chrome']) { const f = path.join(base, sub, w); if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; } } } catch (e) {} } }
let fails = 0;
for (const f of ['character.js', 'shovel.js', 'car.js', 'tree.js']) { const src = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  const bad = src.match(/Math\.random|Date\.now|performance\.now|new Date/); if (bad) { console.log('FAIL', f, 'uses', bad[0], '(not deterministic)'); fails++; } else console.log('PASS', f, 'has no Math.random/Date/performance.now'); }
const { chromium } = loadPW();
const srv = http.createServer((q, s) => { const p = path.join(root, q.url.split('?')[0]); fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); s.end(d); }); });
srv.listen(0, async () => { const port = srv.address().port;
  const b = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage(); pg.on('pageerror', (e) => console.log('PAGEERR', e.message)); pg.on('console', (m) => { const t = m.text(); if (/Shader Error|Program Info Log|THREE\.WebGLProgram/.test(t)) console.log('SHADER', t.slice(0, 300)); });
  await pg.goto(`http://localhost:${port}/objects/selftest.html`);
  try { await pg.waitForFunction('window.RESULT', null, { timeout: 60000 }); } catch (e) { console.log('FAIL: self-test page did not finish (see PAGEERR above)'); process.exit(1); }
  const r = await pg.evaluate('window.RESULT'); for (const c of r.checks) { if (!c.pass) console.log('FAIL', c.name, c.info); }
  const shown = r.checks.filter((c) => /slide|reach|height|expressions/.test(c.name)); for (const c of shown) console.log(c.pass ? 'PASS' : 'FAIL', c.name);
  fails += r.fails; console.log(`${r.checks.length} browser checks, ${r.fails} failed`); console.log(fails ? 'SELFTEST FAILED' : 'SELFTEST OK');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0); });
