import http.server, sys, io, wave, struct, math, json, re
from email.parser import BytesParser
from email.policy import default

def wav():
    b = io.BytesIO(); w = wave.open(b, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
    w.writeframes(b''.join(struct.pack('<h', int(8000*math.sin(i/20))) for i in range(48000*3))); w.close(); return b.getvalue()
WAV = wav()
SVG = b"<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='red'/></svg>"

def parse_multipart(ctype, body):
    msg = BytesParser(policy=default).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
    out = []
    for part in msg.iter_parts():
        out.append((part.get_param('name', header='content-disposition'), part.get_filename(), part.get_payload(decode=True)))
    return out

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype, extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n)
        parts = parse_multipart(self.headers['Content-Type'], body)
        self.send(200, json.dumps([[a, b, len(c), c[:12].decode('latin1')] for a, b, c in parts]).encode(), 'application/json')
    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/page':
            return self.send(200, b"<!doctype html><meta charset=utf-8><audio id=a preload=auto></audio><img id=i><input type=file id=f>", 'text/html')
        if p == '/a-none.wav': return self.send(200, WAV, 'audio/wav', {'Accept-Ranges': 'none'})
        if p == '/a-nohdr.wav': return self.send(200, WAV, 'audio/wav')
        if p == '/a-range.wav':
            rng = self.headers.get('Range')
            if rng:
                m = re.match(r'bytes=(\d+)-(\d*)', rng); s = int(m.group(1)); e = int(m.group(2)) if m.group(2) else len(WAV) - 1
                chunk = WAV[s:e + 1]
                return self.send(206, chunk, 'audio/wav', {'Content-Range': f'bytes {s}-{s+len(chunk)-1}/{len(WAV)}', 'Accept-Ranges': 'bytes'})
            return self.send(200, WAV, 'audio/wav', {'Accept-Ranges': 'bytes'})
        if p == '/pic-cors.svg': return self.send(200, SVG, 'image/svg+xml', {'Access-Control-Allow-Origin': '*'})
        if p == '/pic-nocors.svg': return self.send(200, SVG, 'image/svg+xml')
        self.send(404, b'nf', 'text/plain')
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
