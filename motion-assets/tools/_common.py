"""Shared helpers for the motion-assets tools: static server, browser page with error capture, scanning."""
import contextlib, functools, http.server, json, os, re, socketserver, sys, threading
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ASSETS = os.path.join(ROOT, 'assets')
# Which files are asset modules and how manifest.json is written is defined once, in vbeat_shared (stdlib only).
try:
    import vbeat_shared  # noqa: F401
except ImportError:
    sys.path.insert(0, os.path.join(ROOT, '..', 'shared', 'src'))
from vbeat_shared import assets as _shared_assets
# Namespaces owned by half B (technical). The other half owns story/character/env ids; its refs go to refs/<namespace>/.
NS_DIR = {'tech': 'tech', 'obj': 'objects', 'fx': 'fx'}
B_DIRS = {'technical', 'objects', 'fx'}


class _H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Cache-Control', 'no-store'); super().end_headers()


@contextlib.contextmanager
def serve(directory=ROOT):
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(_H, directory=directory))
    th = threading.Thread(target=srv.serve_forever, daemon=True); th.start()
    try: yield f'http://127.0.0.1:{srv.server_address[1]}'
    finally: srv.shutdown(); srv.server_close()


def scan_modules():
    """All assets/**/*.js (except core/, _dev/) that export an `assets` map, as paths relative to assets/."""
    return _shared_assets.discover_modules(ASSETS)


def all_js():
    out = []
    for dp, dn, fn in os.walk(ASSETS):
        for f in sorted(fn):
            if f.endswith('.js'): out.append(os.path.join(dp, f))
    return sorted(out)


def write_manifest():
    return _shared_assets.write_manifest(ASSETS)


def open_harness(browser, base, errs):
    pg = browser.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.goto(base + '/tools/harness.html'); pg.wait_for_function('window.ready===true', timeout=60000)
    return pg


def out_dir_for(asset_id):
    ns = asset_id.split('/')[0]
    return os.path.join(ROOT, 'refs', NS_DIR.get(ns, ns))


def safe_name(asset_id): return asset_id.split('/', 1)[1].replace('/', '_') if '/' in asset_id else asset_id
