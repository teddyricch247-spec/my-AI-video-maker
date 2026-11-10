#!/usr/bin/env python3
"""QA for motion-assets.  python tools/check.py [--only <id prefix>] [--v2 path/to/v2.html] [--quick]
Checks: lint (forbidden APIs, JSDoc, module-level g/T, cross-half imports), meta schema, console/page errors, determinism, coverage 0..15 s every 0.5 s,
never-blank, idle motion after settling, text inside bounds (min 14 px), ms/frame budgets, pixel regression from qa/regression-*.json. Writes qa-report.md."""
import argparse, base64, glob, io, json, os, re, sys, time
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from _common import *

KINDS = {'pop', 'tick', 'whoosh', 'thud', 'stamp', 'slide', 'chime', 'rustle'}
PTYPES = {'string', 'number', 'boolean', 'color', 'array', 'object', 'image', 'enum'}
MKINDS = {'scene', 'part', 'character', 'prop', 'fx'}; MODES = {'technical', 'story', 'both'}
REQ = ['id', 'kind', 'mode', 'title', 'description', 'duration', 'holds', 'params', 'anchors', 'markers', 'tags', 'bounds', 'origin', 'example']
BUDGET = {'scene': 30, 'part': 8, 'prop': 8, 'fx': 8, 'character': 8}
FORBID = [(r'Math\.random', 'Math.random'), (r'\bnew\s+Date\b|\bDate\s*\.\s*now|\bDate\s*\(', 'Date'), (r'performance\s*\.\s*now', 'performance.now'),
          (r'\bsetTimeout\b|\bsetInterval\b', 'setTimeout/setInterval'), (r'requestAnimationFrame', 'requestAnimationFrame'), (r'\bfetch\s*\(|XMLHttpRequest', 'fetch/XHR'),
          (r'localStorage|sessionStorage|indexedDB', 'storage'), (r'shadowBlur\s*=(?!\s*0\b)', 'shadowBlur'), (r'\.filter\s*=(?!=)', 'ctx.filter'),
          (r'createElement|OffscreenCanvas|document\.body|new\s+Image\b', 'DOM/offscreen creation')]


def strip_code(src):
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'), src, flags=re.S)
    src = re.sub(r'(?<![:\'"`\\])//[^\n]*', '', src)
    return re.sub(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"", "''", src)


def lint():
    res = []  # (file, level, msg)
    for full in all_js():
        rel = os.path.relpath(full, ASSETS).replace(os.sep, '/'); raw = open(full, encoding='utf-8').read(); code = strip_code(raw)
        top = rel.split('/')[0]; is_core = top == 'core'
        if not raw.lstrip().startswith('/**'): res.append((rel, 'FAIL', 'module must start with a JSDoc block'))
        else:
            doc = raw.lstrip()[:raw.lstrip().index('*/')]
            for m in re.finditer(r'^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)', raw, re.M):
                if m.group(1) != 'assets' and m.group(1) not in doc: res.append((rel, 'FAIL', f'export {m.group(1)} not documented in the leading JSDoc'))
        has_assets = re.search(r'^export\s+const\s+assets\b', code, re.M)
        if has_assets:
            ex = [m.group(0) for m in re.finditer(r'^export\s+(?:async\s+)?(?:function|const|let|class)\s+\w+', code, re.M)]
            if not ex[-1].endswith('assets'): res.append((rel, 'FAIL', 'module must END with `export const assets` (it is not the last export)'))
        for pat, name in FORBID:
            for m in re.finditer(pat, code):
                if is_core and name in ('DOM/offscreen creation',): continue
                if is_core and rel == 'core/core.js' and name == 'shadowBlur': continue
                res.append((rel, 'FAIL', f'forbidden API {name} at line {code[:m.start()].count(chr(10)) + 1}'))
        for m in re.finditer(r'^(?:let|var|const)\s+(g|T)\b', code, re.M): res.append((rel, 'FAIL', f'module-level `{m.group(1)}` global'))
        for m in re.finditer(r'''import\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]''', raw):
            spec = m.group(1) or m.group(2)
            if not spec.startswith('.'): res.append((rel, 'FAIL', f'non-relative import {spec}')); continue
            tgt = os.path.normpath(os.path.join(os.path.dirname(full), spec)); trel = os.path.relpath(tgt, ASSETS).replace(os.sep, '/')
            if trel.startswith('..'): res.append((rel, 'FAIL', f'import escapes assets/: {spec}')); continue
            if trel.startswith('core/') and trel not in ('core/core.js', 'core/palette.js'): res.append((rel, 'FAIL', f'import of non-API core file {trel}'))
            elif top in B_DIRS and not (trel.startswith('core/') or trel.split('/')[0] in B_DIRS): res.append((rel, 'FAIL', f'cross-half import {trel}'))
            elif not os.path.exists(tgt): res.append((rel, 'FAIL', f'import target missing {trel}'))
    return res


def schema(id_, m, a):
    e = []
    for k in REQ:
        if k not in m: e.append(f'missing meta.{k}')
    if e: return e
    if m['id'] != id_: e.append('meta.id != registry key')
    if not re.match(r'^(tech|obj|fx)/[a-z0-9][a-z0-9\-]*$', id_) and id_.split('/')[0] in ('tech', 'obj', 'fx'): e.append('id must be lowercase-kebab in its namespace')
    if m['kind'] not in MKINDS: e.append('bad kind')
    if m['mode'] not in MODES: e.append('bad mode')
    if not isinstance(m['duration'], (int, float)) or m['duration'] <= 0: e.append('duration must be > 0')
    if m['holds'] is not True: e.append('holds must be true')
    if len(m['description']) < 30 or len(m['description']) > 400: e.append('description should be 1-2 sentences (30-400 chars)')
    for k, v in m['params'].items():
        if not isinstance(v, dict) or not {'type', 'default', 'desc'} <= set(v): e.append(f'param {k}: needs type/default/desc')
        elif v['type'] not in PTYPES: e.append(f'param {k}: bad type {v["type"]}')
        elif not v['desc']: e.append(f'param {k}: empty desc')
    for k, v in m['anchors'].items():
        if not isinstance(v, dict) or not isinstance(v.get('default'), (int, float)) or isinstance(v.get('default'), bool): e.append(f'anchor {k}: default must be numeric')
        elif not v.get('desc'): e.append(f'anchor {k}: empty desc')
    if not isinstance(m['markers'], list) or any(k not in KINDS for k in m['markers']): e.append('meta.markers must list allowed kinds')
    if not isinstance(m['tags'], list) or not m['tags']: e.append('tags must be a non-empty list')
    if not (isinstance(m['bounds'], list) and len(m['bounds']) == 4 and all(isinstance(x, (int, float)) for x in m['bounds'])): e.append('bounds must be [x,y,w,h]')
    if not (isinstance(m['origin'], list) and len(m['origin']) == 2): e.append('origin must be [x,y]')
    if not isinstance(m['example'], str) or id_ not in m['example']: e.append('example must be a string that mentions the asset id')
    if m['kind'] == 'scene' and 'bg' not in m['params']: e.append('scenes need a `bg` param')
    return e


def ns_ok(id_, module):
    ns = id_.split('/')[0]; top = (module or '').split('/')[0]
    if top in B_DIRS and ns not in NS_DIR: return f'id {id_} outside tech/obj/fx namespaces but module is in half B folders'
    return None


def text_issues(log, kind, t):
    issues = []; M = 20 if kind == 'scene' else 0
    for r in log:
        sc = (abs(r['a'] * r['d'] - r['b'] * r['c'])) ** .5; size = r['size'] * sc
        if size < 13.99: issues.append(f'"{r["s"][:18]}" {size:.1f}px < 14'); continue
        off = {'center': -.5, 'right': -1, 'end': -1}.get(r['align'], 0); x0, x1 = r['x'] + off * r['w'], r['x'] + off * r['w'] + r['w']; y0, y1 = r['y'] - r['size'] * .78, r['y'] + r['size'] * .22
        xs, ys = [], []
        for X, Y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)): xs.append(r['a'] * X + r['c'] * Y + r['e']); ys.append(r['b'] * X + r['d'] * Y + r['f'])
        if min(xs) < M - 1 or max(xs) > 1280 - M + 1 or min(ys) < M - 1 or max(ys) > 720 - M + 1: issues.append(f'"{r["s"][:18]}" outside bounds ({min(xs):.0f},{min(ys):.0f})-({max(xs):.0f},{max(ys):.0f})')
    return issues


def decode(url): return np.array(Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGB')).astype(np.int16)


def regression(b, base, v2path, only):
    out = []
    files = sorted(glob.glob(os.path.join(ROOT, 'qa', 'regression-*.json')))
    if not files: return [('-', '-', 'WARN', 'no qa/regression-*.json')]
    if not v2path or not os.path.exists(v2path): return [('-', '-', 'WARN', 'v2.html not found; pass --v2 <path> (searched ROOT, ROOT/.. and qa/)')]
    html = open(v2path, encoding='utf-8').read()
    v2 = b.new_page(viewport={'width': 1280, 'height': 720}); v2.goto(base + '/assets/core/fonts.css'); v2.set_content(html)
    v2.add_style_tag(url=base + '/assets/core/fonts.css')
    v2.evaluate("Promise.all(['700 20px Lora','italic 700 20px Lora','700 20px Poppins','400 16px \"DejaVu Sans Mono\"','700 16px \"DejaVu Sans Mono\"'].map(f=>document.fonts.load(f,'Aa0')))")
    h = open_harness(b, base, [])
    for f in files:
        for e in json.load(open(f)):
            if only and not e['id'].startswith(only): continue
            for t in e['times']:
                v2.evaluate(f"draw('{e['v2scene']}',{t})"); ref = decode(v2.evaluate("document.getElementById('c').toDataURL('image/png')"))
                h.evaluate("([id,t])=>{window.drawAsset(id,t,{});}", [e['id'], t]); new = decode(h.evaluate('window.png()'))
                frac = float((np.abs(ref - new).max(axis=2) > 8).mean()) * 100
                out.append((e['id'], t, 'PASS' if frac <= .5 else 'FAIL', f'{frac:.3f}% pixels differ (>8/255)'))
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--only', default=''); ap.add_argument('--v2', default=os.environ.get('V2_HTML', '')); ap.add_argument('--quick', action='store_true')
    a = ap.parse_args(); write_manifest()
    v2 = a.v2 or next((p for p in [os.path.join(ROOT, 'v2.html'), os.path.join(ROOT, '..', 'v2.html'), os.path.join(ROOT, 'qa', 'v2.html')] if os.path.exists(p)), '')
    L = lint(); rows = []; fails = 0; t0 = time.time()
    with serve() as base, sync_playwright() as p:
        b = p.chromium.launch(); errs = []; pg = open_harness(b, base, errs)
        metas = pg.evaluate('window.metas()'); dups = pg.evaluate('window.dups'); le = pg.evaluate('window.loadErrors')
        ids = [i for i in sorted(metas) if i.startswith(a.only)]
        for i, id_ in enumerate(ids):
            m = metas[id_]; probs = []; warns = []; errs.clear()
            probs += schema(id_, m, None); n = ns_ok(id_, m.get('module'));
            if n: probs.append(n)
            if id_ in dups: probs.append('duplicate id')
            one = bool(m.get('oneShot')); kind = m['kind']
            try:
                # markers
                mk = pg.evaluate('(id)=>window.markers(id,{})', id_)
                if not isinstance(mk, list): probs.append('markers() must return an array')
                else:
                    for x in mk:
                        if not (isinstance(x.get('t'), (int, float)) and x['t'] >= 0) or x.get('kind') not in KINDS or not x.get('id'): probs.append(f'bad marker {x}'); break
                    bad = {x['kind'] for x in mk} - set(m['markers'])
                    if bad: probs.append(f'markers use kinds not listed in meta.markers: {sorted(bad)}')
                    if not mk: warns.append('no markers')
                if m['anchors']:
                    k0 = next(iter(m['anchors'])); sh = pg.evaluate('([id,k])=>window.markers(id,{at:{[k]:9}})', [id_, k0])
                    if not isinstance(sh, list): probs.append('markers() ignores params.at')
                # determinism
                det = pg.evaluate("""([id])=>{const h=(t,p)=>{const d=window.pixels(id,t,p||{});let s=0,s2=0;for(let i=0;i<d.length;i+=4){s=(s*31+d[i]+d[i+1]*3+d[i+2]*7)>>>0;s2=(s2+d[i]*(i%97+1))>>>0}return s+':'+s2};
                  const a0=h(0),a3=h(3),a3b=h(3),a0b=h(0),a3c=h(3,{});return {same:a3===a3b&&a3===a3c,order:a0===a0b}}""", [id_])
                if not det['same']: probs.append('non-deterministic: same t twice differs')
                if not det['order']: probs.append('state leaks between calls: draw t=3 then t=0 != fresh t=0')
                # coverage + blank + errors
                blank = []
                for k in range(31):
                    t = k * .5; px = pg.evaluate("""([id,t])=>{const d=window.pixels(id,t,{});let n=0;const mr=d[0],mg=d[1],mb=d[2];
                       // fraction of pixels far from the (grain-free) median-ish reference: compare to the 3 most common coarse colours
                       const h=new Map();for(let i=0;i<d.length;i+=64){const key=(d[i]>>4)<<8|(d[i+1]>>4)<<4|(d[i+2]>>4);h.set(key,(h.get(key)||0)+1)}
                       let best=0,bk=0;h.forEach((v,k)=>{if(v>best){best=v;bk=k}});const r0=(bk>>8)*16+8,g0=((bk>>4)&15)*16+8,b0=(bk&15)*16+8;
                       for(let i=0;i<d.length;i+=16){if(Math.abs(d[i]-r0)+Math.abs(d[i+1]-g0)+Math.abs(d[i+2]-b0)>110)n++}return n/(d.length/16)}""", [id_, t])
                    if px < .00004 and t >= 1.0 and not one: blank.append(t)
                if one:
                    pt = m.get('previewT', 0.5); pxv = pg.evaluate("([id,t])=>{const d=window.pixels(id,t,{});let n=0;for(let i=0;i<d.length;i+=16){if(Math.abs(d[i]-d[0])+Math.abs(d[i+1]-d[1])+Math.abs(d[i+2]-d[2])>110)n++}return n}", [id_, pt])
                    if pxv < 20: probs.append(f'one-shot fx is blank at its previewT={pt}')
                if blank: probs.append(f'blank frames at t={blank[:4]}')
                # idle
                if not one:
                    idl = pg.evaluate("""([id])=>{const a=window.pixels(id,8,{}).slice(),b=window.pixels(id,8.5,{});let n=0;for(let i=0;i<a.length;i+=4){if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>6)n++}return n/(1280*720)}""", [id_])
                    if idl <= 0: probs.append('no idle motion: t=8 and t=8.5 identical')
                    elif idl > .25: probs.append(f'idle motion too large ({idl*100:.1f}% of pixels)')
                # text
                tl = []
                for t in (8, 15):
                    pg.evaluate("([id,t])=>{window.textLog=[];window.logText=true;window.pixels(id,t,{});window.logText=false}", [id_, t]); tl += text_issues(pg.evaluate('window.textLog'), kind, t)
                if tl: probs.append('text: ' + '; '.join(sorted(set(tl))[:3]))
                # perf
                bud = BUDGET.get(kind, 8); worst = 0; 
                for tt in (1.5, 6):
                    r = pg.evaluate('([id,t])=>window.timeDraw(id,t,{},14)', [id_, tt]); worst = max(worst, r['median'])
                if worst > bud: probs.append(f'perf {worst:.1f} ms > budget {bud} ms')
                perf = worst
            except Exception as ex:
                probs.append('EXCEPTION ' + str(ex).split('\n')[0][:160]); perf = -1
            errs_i = [e for e in errs if 'favicon' not in e]
            if errs_i: probs.append('console/page errors: ' + ' | '.join(errs_i[:2]))
            st = 'FAIL' if probs else ('WARN' if warns else 'PASS'); fails += bool(probs)
            rows.append((id_, st, perf, probs + warns)); print(f'[{i+1}/{len(ids)}] {st} {id_} {perf:.1f}ms ' + ('; '.join((probs + warns)[:3])), flush=True)
        for e in le: rows.append(('module-load', 'FAIL', 0, [e])); fails += 1
        demo_rows = []
        for f in sorted(glob.glob(os.path.join(ROOT, 'demos', 'tech', '*.js'))):
            nm = os.path.basename(f)[:-3]
            if a.only and not ('tech/' + nm).startswith(a.only): continue
            try:
                errs.clear(); res = []
                for t in (.4, 2.5, 8):
                    res.append(pg.evaluate("async ([n,t])=>{await window.runDemo(n,t);const d=window.G_px?0:0;return 1}", [nm, t]))
                demo_rows.append((nm, 'PASS', ''))
            except Exception as ex: demo_rows.append((nm, 'FAIL', str(ex).split('\n')[0][:140]))
            if errs: demo_rows[-1] = (nm, 'FAIL', errs[0][:140])
        fails += sum(1 for r in demo_rows if r[1] == 'FAIL')
        reg = [] if a.quick else regression(b, base, v2, a.only)
        b.close()
    lint_rows = [r for r in L if (not a.only or True)]
    fails += sum(1 for r in lint_rows if r[1] == 'FAIL') + sum(1 for r in reg if r[2] == 'FAIL')
    ln = ['# QA report', f'Generated {time.strftime("%Y-%m-%d %H:%M")} - {len(ids)} assets checked in {time.time()-t0:.0f}s - **{"FAIL" if fails else "PASS"}** ({fails} failing items)', '']
    ln += ['## Lint', *(f'- FAIL `{f}`: {m}' for f, l, m in lint_rows), *(['- clean'] if not lint_rows else []), '', '## Assets', '| id | status | ms | notes |', '|---|---|---|---|']
    ln += [f'| {i} | {s} | {pf:.1f} | {"; ".join(n)[:300]} |' for i, s, pf, n in rows]
    ln += ['', '## Pixel regression vs v2.html (fail > 0.5 % pixels differing by > 8/255)', '| id | t | status | detail |', '|---|---|---|---|', *(f'| {i} | {t} | {s} | {d} |' for i, t, s, d in reg)]
    ln += ['', '## Demos (demos/tech/*.js, demo(g,t) at t=0.4, 2.5, 8)', *(f'- {s} `{n}` {d}' for n, s, d in demo_rows)]
    open(os.path.join(ROOT, 'qa-report.md'), 'w').write('\n'.join(ln) + '\n')
    for f, l, m in lint_rows: print('LINT', f, m)
    for r in reg: print('REG', *r)
    print(f'{"FAIL" if fails else "PASS"}: {fails} failing items; report -> qa-report.md'); return 1 if fails else 0
if __name__ == '__main__': sys.exit(main())
