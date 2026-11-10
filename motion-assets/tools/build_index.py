#!/usr/bin/env python3
"""Scan assets/**/*.js, write assets/manifest.json (module list for the harness) and assets/index.json (all metas).
Works unchanged after the other half is merged into the same folder:  python tools/build_index.py"""
import json, sys, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from _common import *

def main():
    mods = write_manifest(); errs = []
    with serve() as base, sync_playwright() as p:
        b = p.chromium.launch(); pg = open_harness(b, base, errs)
        metas = pg.evaluate('window.metas()'); dups = pg.evaluate('window.dups'); le = pg.evaluate('window.loadErrors'); b.close()
    items = [metas[k] for k in sorted(metas)]
    idx = {'version': 1, 'count': len(items), 'modules': mods, 'assets': items}
    with open(os.path.join(ASSETS, 'index.json'), 'w') as f: json.dump(idx, f, indent=1)
    print(f'{len(mods)} modules, {len(items)} assets -> assets/index.json')
    for e in errs + [f'DUPLICATE id {d}' for d in dups] + [f'LOAD ERROR {e}' for e in le]: print('!!', e)
    return 1 if (dups or le or any('pageerror' in e for e in errs)) else 0
if __name__ == '__main__': sys.exit(main())
