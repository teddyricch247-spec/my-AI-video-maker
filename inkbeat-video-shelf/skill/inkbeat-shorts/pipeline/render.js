const http=require('http'),fs=require('fs'),path=require('path');
// node render.js --scene char_preview --frames 0-59 --w 720 --h 1280 --out out/run1  (resumable: skips existing frames)
// 16:9: --w 1280 --h 720. Captions: --caps word|sentence|0  --capscale 1  --accent '#ffd23f'  (defaults: word for portrait, sentence for landscape)
function loadPW(){ const cp=require('child_process'); let g=''; try{g=cp.execSync('npm root -g',{stdio:['ignore','pipe','ignore']}).toString().trim()}catch(e){}
  for(const m of ['playwright','playwright-core','/opt/npm-tools/node_modules/playwright',g&&g+'/playwright',g&&g+'/playwright-core'].filter(Boolean)){ try{return require(m)}catch(e){} }
  console.log('FATAL: no playwright module. Run:  npm i playwright-core   (no browser download needed if Chrome/headless-shell exists)'); process.exit(3); }
const {chromium}=loadPW();
function findChrome(){ if(process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots=['/ms-playwright','/opt/pw-browsers',process.env.PLAYWRIGHT_BROWSERS_PATH,require('os').homedir()+'/.cache/ms-playwright'].filter(Boolean);
  const want=['chrome-headless-shell','chrome'];
  for(const r of roots){ try{ for(const d of fs.readdirSync(r)){ const base=path.join(r,d); for(const sub of ['',...fs.readdirSync(base).filter(x=>/linux/.test(x))]){ for(const w of want){ const f=path.join(base,sub,w); if(fs.existsSync(f)&&fs.statSync(f).isFile()) return f; } } } }catch(e){} }
  return undefined; } 
const a=Object.fromEntries(process.argv.slice(2).reduce((r,x,i,v)=>x.startsWith('--')?[...r,[x.slice(2),v[i+1]]]:r,[]));
const [f0,f1]=(a.frames||'0-0').split('-').map(Number), w=+a.w||720,h=+a.h||1280,fps=+a.fps||30,out=a.out||'out/run',scene=a.scene||'char_preview',view=a.view;
const frameList=a['frames-list']?a['frames-list'].split(',').map(Number).filter(Number.isFinite):Array.from({length:Math.max(0,f1-f0+1)},(_,i)=>f0+i);
fs.mkdirSync(out,{recursive:true}); const root=path.join(__dirname,'..');
const wordsFile=a.words;
const srv=http.createServer((q,s)=>{ if(wordsFile&&q.url.startsWith('/words.json')){s.writeHead(200,{'content-type':'application/json'});return s.end(fs.readFileSync(wordsFile));}
 const p=path.join(root,q.url.split('?')[0]);fs.readFile(p,(e,d)=>{if(e){s.writeHead(404);s.end();return}
  s.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':'text/html'});s.end(d)})});
srv.listen(0,async()=>{const port=srv.address().port; const b=await chromium.launch({executablePath:findChrome(),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const pg=await b.newPage(); pg.on('pageerror',e=>console.log('PAGEERR',e.message)); pg.on('console',m=>{const t=m.text(); if(!/GL Driver/.test(t)){console.log('CONSOLE',t.slice(0,400)); if(/Shader Error|Program Info Log/.test(t)){console.log('FATAL: shader failed to compile'); process.exit(2)}}});
 await pg.goto(`http://localhost:${port}/pipeline/page.html?scene=${scene}&w=${w}&h=${h}&fps=${fps}&sub=${a.sub||1}${view?'&view='+view:''}${wordsFile?'&words=1':''}${a.ink?'&ink='+a.ink:''}${a.caps?'&caps='+a.caps:''}${a.capscale?'&capscale='+a.capscale:''}${a.accent?'&accent='+encodeURIComponent(a.accent):''}${a.q?'&'+a.q:''}`); await pg.waitForFunction('window.READY',null,{timeout:60000});
 const t0=Date.now(); let n=0;
 for(const f of frameList){const fn=path.join(out,String(f).padStart(4,'0')+'.jpg'); if(fs.existsSync(fn))continue;
  const d=await pg.evaluate(([f,v])=>window.renderFrame(f,v),[f,view?+view:null]); fs.writeFileSync(fn,Buffer.from(d.split(',')[1],'base64')); n++;}
 console.log(`rendered ${n} frames in ${((Date.now()-t0)/1000).toFixed(1)}s (${n?((Date.now()-t0)/n/1000).toFixed(2):0}s/frame) at ${w}x${h}`);
 await b.close(); srv.close();});
