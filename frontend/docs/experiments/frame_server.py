"""Experiment server: tries header variants for a sandboxed (opaque-origin) iframe.
Variant is chosen by the ?v= query on the parent page and echoed through a cookie-less path prefix.
Paths: /v/<variant>/... so each variant has its own header policy.
"""
import http.server, json, sys, threading, wave, io, struct, math, re

LOG = []

def wav_bytes():
    buf = io.BytesIO()
    w = wave.open(buf, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
    w.writeframes(b''.join(struct.pack('<h', int(8000*math.sin(i/20))) for i in range(48000)))
    w.close(); return buf.getvalue()
WAV = wav_bytes()

FRAME = b"""<!doctype html><meta charset=utf-8><canvas id=c width=64 height=36></canvas>
<script type=module src="/v/%V%/frame.js"></script>"""

FRAME_JS = b"""
const out = {};
out.origin = String(location.origin);
try { out.hasCookie = 'readable:' + document.cookie } catch (e) { out.hasCookie = 'blocked:' + e.name }
try { out.ls = typeof localStorage; localStorage.x = 1; out.ls='allowed' } catch (e) { out.ls = 'blocked:' + e.name }
parent.postMessage({type:'ready'}, '*');
addEventListener('message', async (e) => {
  if (e.data.type !== 'load') return;
  const r = {};
  try { const m = await import(e.data.runtime); r.runtime = m.hello(); } catch (err) { r.runtime = 'ERR ' + err.message; }
  try { const x = await fetch(e.data.scene); r.fetch = (await x.text()).slice(0, 20); } catch (err) { r.fetch = 'ERR ' + err.message; }
  try { const m2 = await import(e.data.asset); r.asset = m2.name; } catch (err) { r.asset = 'ERR ' + err.message; }
  try {
    const img = new Image(); img.src = e.data.img; await img.decode(); r.img = 'ok ' + img.width;
    const c = document.getElementById('c').getContext('2d'); c.drawImage(img, 0, 0);
    try { c.getImageData(0,0,1,1); r.tainted = false } catch (er) { r.tainted = true }
    const img2 = new Image(); img2.crossOrigin = 'anonymous'; img2.src = e.data.img + '?co=1'; await img2.decode();
    const c2 = document.createElement('canvas'); c2.width = c2.height = 8; const x2 = c2.getContext('2d'); x2.drawImage(img2, 0, 0);
    try { x2.getImageData(0,0,1,1); r.taintedWithCrossOriginAttr = false } catch (er) { r.taintedWithCrossOriginAttr = true }
  } catch (err) { r.img = 'ERR ' + err.message; }
  try { const ac = new (window.AudioContext||window.webkitAudioContext)(); r.audioctx = ac.state; } catch (err) { r.audioctx = 'ERR ' + err.message; }
  r.out = out;
  parent.postMessage({type:'result', r}, '*');
});
"""

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype, extra=None, v=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, val in (extra or {}).items(): self.send_header(k, val)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path = self.path.split('?')[0]
        cookie = self.headers.get('Cookie', '')
        LOG.append((path, 'cookie' if cookie else 'nocookie', self.headers.get('Origin'), self.headers.get('Sec-Fetch-Mode'), self.headers.get('Sec-Fetch-Site')))
        if path == '/log': return self.send(200, json.dumps(LOG).encode(), 'application/json')
        if path == '/parent':
            v = self.path.split('v=')[1]
            html = ('<!doctype html><meta charset=utf-8><iframe id=f sandbox="allow-scripts" src="/v/%s/frame.html"></iframe><script>'
                    'window.res=null;window.ready=false;window.errs=[];'
                    'onmessage=(e)=>{if(e.data.type==="ready"){ready=true;f.contentWindow.postMessage({type:"load",runtime:"/v/%s/runtime.js",scene:"/v/%s/scene.js",asset:"/v/%s/asset.js",img:"/v/%s/pic.svg"},"*")}if(e.data.type==="result")res=e.data.r}'
                    '</script>' % (v, v, v, v, v)).encode()
            return self.send(200, html, 'text/html', {'Set-Cookie': 'sid=abc; HttpOnly; Path=/; SameSite=Lax'})
        m = re.match(r'/v/(\w+)/(.*)', path)
        if not m: return self.send(404, b'nf', 'text/plain')
        v, name = m.groups()
        cors = {} if v in ('nocors',) else {'Access-Control-Allow-Origin': '*'}
        mime_js = 'text/plain' if v == 'badmime' else 'text/javascript'
        if name == 'frame.html':
            csp = {}
            if v == 'csp':
                csp = {'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'"}
            return self.send(200, FRAME.replace(b'%V%', v.encode()), 'text/html', csp)
        if name == 'frame.js': return self.send(200, FRAME_JS, mime_js, cors)
        if name == 'runtime.js': return self.send(200, b"export function hello(){return 'runtime-ok'}", mime_js, cors)
        if name == 'asset.js': return self.send(200, b"export const name='asset-ok'", mime_js, cors)
        if name == 'scene.js': return self.send(200, b"scene-code-here-long", 'text/javascript', cors)
        if name == 'pic.svg': return self.send(200, b"<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='red'/></svg>", 'image/svg+xml', cors)
        if name == 'a.wav': return self.send(200, WAV, 'audio/wav', {'Accept-Ranges': 'none'})
        self.send(404, b'nf', 'text/plain')

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
