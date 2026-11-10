#!/usr/bin/env python3
"""Reproduces the browser experiments behind docs/BACKEND_NEEDS.md (needs Playwright + Chrome/Chromium).
   python docs/experiments/run.py
1. A sandbox="allow-scripts" iframe (opaque origin) importing modules / fetching / loading images, under header variants.
2. <audio> seeking with and without HTTP Range support.
3. Multipart upload from a file input, a pasted-text Blob and an oddly named file.
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
CH = os.environ.get('VBEAT_CHROME_CHANNEL', 'chrome')

def server(script, port):
    p = subprocess.Popen([sys.executable, '-I', os.path.join(HERE, script), str(port)]); time.sleep(0.8); return p

with sync_playwright() as pw:
    try: b = pw.chromium.launch(channel=CH, headless=True, args=['--no-sandbox'])
    except Exception: b = pw.chromium.launch(headless=True, args=['--no-sandbox'])
    s = server('frame_server.py', 8841)
    try:
        for v in ('good', 'nocors', 'badmime', 'csp'):
            pg = b.new_context().new_page(); errs = []
            pg.on('console', lambda m, e=errs: e.append(m.text[:110]) if m.type == 'error' else None)
            pg.goto('http://127.0.0.1:8841/parent?v=' + v)
            try:
                pg.wait_for_function('window.res !== null', timeout=4000); print('1.', v, json.dumps(pg.evaluate('window.res')))
            except Exception: print('1.', v, 'FAILED to run', errs[:2])
    finally: s.terminate()
    s = server('media_server.py', 8842)
    try:
        pg = b.new_context().new_page(); pg.goto('http://127.0.0.1:8842/page')
        for n in ('a-none.wav', 'a-range.wav'):
            print('2.', n, pg.evaluate("""async (n) => { const a = document.getElementById('a'); a.src = '/' + n; a.load();
              await new Promise(r => a.addEventListener('canplaythrough', r, {once: true})); a.currentTime = 1.5;
              await new Promise(r => a.addEventListener('seeked', r, {once: true})); return {seekableEnd: a.seekable.end(0), afterSeek: a.currentTime} }""", n))
        pg.set_input_files('#f', files=[{'name': 'talk.srt', 'mimeType': 'text/plain', 'buffer': b'hello'}])
        print('3. file input:', pg.evaluate("fetch('/up', {method: 'POST', body: (() => { const f = new FormData(); f.append('file', document.getElementById('f').files[0]); return f })()}).then(r => r.json())"))
        print('3. blob      :', pg.evaluate("fetch('/up', {method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob(['pasted'], {type: 'text/plain'}), 'pasted.txt'); return f })()}).then(r => r.json())"))
        print('3. odd name  :', pg.evaluate("fetch('/up', {method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob(['x']), 'a \"q\" ü.png'); return f })()}).then(r => r.json())"))
    finally: s.terminate()
    b.close()
