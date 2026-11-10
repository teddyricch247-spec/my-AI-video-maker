#!/usr/bin/env python3
"""Render reference images.  python tools/shoot.py [--only <id prefix>] [--no-catalog] [--ns tech,obj,fx]
 * refs/<ns>/<id>.png : 2x2 contact sheet at t = 0.4 s, 25 %, 60 % and the end of meta.duration (scenes at full frame; parts/fx zoomed)
 * refs/_catalog_icons.png : every obj/* with its id;  refs/_catalog_fx.png : every fx/* with its id
Prints console/page errors. Works unchanged after the other half is merged (use --ns to include its namespaces)."""
import argparse, base64, io, os, sys
from PIL import Image
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from _common import *

def png_of(url): return Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGB')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--only', default=''); ap.add_argument('--no-catalog', action='store_true'); ap.add_argument('--ns', default='tech,obj,fx')
    a = ap.parse_args(); ns = set(a.ns.split(',')); write_manifest(); errs = []
    with serve() as base, sync_playwright() as p:
        b = p.chromium.launch(); pg = open_harness(b, base, errs); metas = pg.evaluate('window.metas()')
        for id_ in sorted(metas):
            if not id_.startswith(a.only) or id_.split('/')[0] not in ns: continue
            m = metas[id_]; d = m['duration']; ts = [.4, d * .25, d * .6, d]; scene = m['kind'] == 'scene'
            if not scene: ts = [.3, .8, 2.0, 8.0]
            sheet = Image.new('RGB', (1280, 720))
            for k, t in enumerate(ts):
                pg.evaluate("([id,t,s])=>window.drawAsset(id,t,{},{s})", [id_, t, 1 if scene else (3 if m['kind'] != 'fx' else 2.2)])
                sheet.paste(png_of(pg.evaluate('window.png()')).resize((640, 360), Image.LANCZOS), ((k % 2) * 640, (k // 2) * 360))
            od = out_dir_for(id_); os.makedirs(od, exist_ok=True); sheet.save(os.path.join(od, safe_name(id_) + '.png'))
        if not a.no_catalog and (not a.only or a.only[:3] in ('obj', 'fx/')):
            for name, pre, cols, cw, ch, s, title in (('_catalog_icons.png', 'obj/', 8, 190, 200, .8, 'obj/* icon catalog (t=3 s)'), ('_catalog_fx.png', 'fx/', 6, 250, 220, .7, 'fx/* catalog (each at its showcase time)')):
                ids = [i for i in sorted(metas) if i.startswith(pre)]
                if not ids: continue
                tmap = {i: metas[i].get('previewT', 3) for i in ids}
                url = pg.evaluate("([ids,o])=>window.catalog(ids,o)", [ids, {'cols': cols, 'cw': cw, 'ch': ch, 's': s, 'title': title, 'tmap': tmap}])
                png_of(url).save(os.path.join(ROOT, 'refs', name))
        b.close()
    print('errors:', errs or 'none'); return 1 if errs else 0
if __name__ == '__main__': sys.exit(main())
