#!/usr/bin/env python3
"""vbeat mock server: the whole frozen API contract v1 in memory, stdlib only.

Serves ../web at "/" and simulates the project lifecycle on a 0.2 s tick thread.

    python mock/server.py                      # http://127.0.0.1:8000, password "demo"
    python mock/server.py --port 8765 --speed 3
    python mock/server.py --cold-start 20      # every request answers 503 for the first 20 s

Mock-only extras (not part of the contract):
    --speed N            run all simulated timers N times faster (tests use this)
    POST /__test/expire  invalidate every login cookie (next API call gives 401)
    POST /__test/cold?s=N  answer 503 to everything except /__test/* for N seconds
"""
import argparse
import array
import io
import json
import math
import os
import re
import secrets
import sys
import threading
import time
import wave
import zipfile
from email.parser import BytesParser
from email.policy import default as email_default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), 'web')
RUNTIME_DIR = os.path.join(HERE, 'mock-runtime')
PASSWORD = 'demo'
LOCK = threading.RLock()
SPEED = 1.0
COLD_UNTIL = 0.0

DB = {'projects': {}, 'beats': {}, 'sessions': {}, 'exports': {}, 'media': {}}
AUTH = set()

SETTINGS = {
    'models': {'director': 'aurora-70b', 'beat': 'basil-vision'},
    'caps': {'run_usd': 25.0, 'daily_usd': 50.0, 'max_steps': 40, 'max_minutes': 20},
    'beat_concurrency': 1,
    'sfx_peak_dbfs': -3,
    'kill_switch': False,
}
MODELS = [
    {'id': 'aurora-70b', 'name': 'Aurora 70B', 'supports_tools': True, 'supports_images': True, 'price_in': 3.0, 'price_out': 15.0},
    {'id': 'aurora-8b', 'name': 'Aurora 8B (no tools)', 'supports_tools': False, 'supports_images': True, 'price_in': 0.2, 'price_out': 0.8},
    {'id': 'basil-vision', 'name': 'Basil Vision', 'supports_tools': True, 'supports_images': True, 'price_in': 1.0, 'price_out': 5.0},
    {'id': 'cedar-mini', 'name': 'Cedar Mini (text only)', 'supports_tools': True, 'supports_images': False, 'price_in': 0.15, 'price_out': 0.6},
    {'id': 'delta-long', 'name': 'Delta Long Context', 'supports_tools': True, 'supports_images': True, 'price_in': 2.5, 'price_out': 10.0},
    {'id': 'ember-fast', 'name': 'Ember Fast', 'supports_tools': True, 'supports_images': False, 'price_in': 0.1, 'price_out': 0.4},
    {'id': 'fjord-reason', 'name': 'Fjord Reason', 'supports_tools': False, 'supports_images': False, 'price_in': 5.0, 'price_out': 25.0},
    {'id': 'garnet-lite', 'name': 'Garnet Lite', 'supports_tools': True, 'supports_images': True, 'price_in': 0.4, 'price_out': 1.6},
]

TITLES = ['Cold open', 'The problem', 'Why it matters', 'Meet the system', 'Data flows in', 'Three key numbers',
          'The turning point', 'A closer look', 'Edge cases', 'What changed', 'The payoff', 'Call to action']
ALT_TITLES = ['The hook', 'Stakes rise', 'Under the hood', 'Zoom out', 'Numbers that land', 'The reveal']
DIRECTIONS = [
    'Kinetic type over a dark gradient; punch in on the key noun.',
    'Split screen: the old way on the left, the new way on the right.',
    'Slow push-in on one big number, then count it up.',
    'Boxes and arrows draw themselves, one per spoken noun.',
    'Particles stream left to right and settle into a bar chart.',
    'Three stat cards slide in on the beat of each number.',
    'Hard cut to white, then rebuild the scene in the brand colour.',
    'Magnifier sweeps over a dense grid and reveals one cell.',
    'Glitch the layout on every "except", then snap back.',
    'Before and after wipe with a thin tomato line.',
    'Confetti of small squares resolves into the logo.',
    'End card with one line of text and a pulsing arrow.',
]
WORDS = ('the quiet harbor wakes before dawn as small boats slide out past the breakwater and every engine '
         'hums a slightly different note while gulls argue over the first catch of the day and the light '
         'turns from grey to gold across the water so we start with a simple question what would it take '
         'to make this whole morning visible to everyone watching from a kitchen window far away').split()


# ---------------------------------------------------------------- helpers
def now():
    return time.time()


def iso(ts=None):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now() if ts is None else ts))


def sd(sec):
    """simulated duration, scaled by --speed"""
    return sec / SPEED


def tc(sec):
    sec = int(sec)
    return '%02d:%02d' % (sec // 60, sec % 60)


def pub(o):
    return {k: v for k, v in o.items() if not k.startswith('_')}


def xml(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


class HttpError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def bump(pid):
    P = DB['projects'].get(pid)
    if P:
        P['_rev'] += 1


# ---------------------------------------------------------------- media, strips, wav
def strip_url(bid, n):
    return '/files/strip/%s/%d.svg' % (bid, n)


def strip_svg(b, n):
    h = (b['idx'] * 47 + n * 13) % 360
    panels = []
    for i in range(4):
        x = i * 160
        cx = 30 + (i * 37 + n * 23 + b['idx'] * 11) % 100
        panels.append(
            '<rect x="%d" y="0" width="160" height="90" fill="hsl(%d,55%%,%d%%)"/>' % (x, h, 28 + i * 9) +
            '<circle cx="%d" cy="%d" r="%d" fill="hsl(%d,80%%,70%%)" opacity=".85"/>' % (x + cx, 30 + i * 8, 10 + i * 4, (h + 40) % 360) +
            '<rect x="%d" y="70" width="%d" height="6" fill="#F3EAD7" opacity=".8"/>' % (x + 10, 30 + i * 30))
    footer = ('<rect y="90" width="640" height="30" fill="#221E1A"/>'
              '<text x="10" y="111" font-size="16" font-weight="700" fill="#F3EAD7">#%d  %s</text>'
              '<text x="630" y="111" font-size="13" text-anchor="end" fill="#F2B531">v%d</text></svg>') % (b['idx'], xml(b['title'])[:42], n)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 120" width="640" height="120" font-family="sans-serif">' + ''.join(panels) + footer


def spectrogram_svg(bid, n):
    seed = sum(ord(c) for c in bid) + n * 7
    cells = []
    for i in range(32):
        for j in range(8):
            v = (seed * (i + 3) * (j + 5)) % 100
            cells.append('<rect x="%d" y="%d" width="10" height="15" fill="hsl(%d,70%%,%d%%)"/>' % (i * 10, j * 15, 20 + (v % 40), 15 + v // 2))
    label = '<text x="6" y="14" font-size="11" font-family="sans-serif" fill="#fff">spectrogram (placeholder) v%d</text></svg>' % n
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="320" height="120">' + ''.join(cells) + label


WAV_CACHE = {}


def make_wav(duration_s, n, markers):
    key = (round(duration_s, 2), n, tuple(markers))
    if key in WAV_CACHE:
        return WAV_CACHE[key]
    rate = 48000
    total = int(rate * max(0.5, duration_s))
    buf = array.array('h', bytes(2 * total))
    freq = 440 * (1 + 0.2 * (n % 5))
    for t in markers:
        start = int(t * rate)
        for i in range(int(rate * 0.12)):
            if start + i >= total:
                break
            env = math.exp(-i / (rate * 0.03))
            buf[start + i] = int(14000 * env * math.sin(2 * math.pi * freq * i / rate))
    out = io.BytesIO()
    w = wave.open(out, 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(buf.tobytes() if sys.byteorder == 'little' else buf.byteswap() or buf.tobytes())
    w.close()
    WAV_CACHE[key] = out.getvalue()
    return WAV_CACHE[key]


def markers_for(dur):
    """cut marker every 2 s from 1.0, sfx marker half a second after each"""
    ms, t, i = [], 1.0, 0
    while t < dur - 0.2:
        ms.append({'id': 'm%d' % i, 't': round(t, 3), 'kind': 'sfx' if i % 2 == 0 else 'cut'})
        t += 2.0
        i += 1
    return ms


def sfx_times(b):
    return [m['t'] for m in markers_for(b['duration_s']) if m['kind'] == 'sfx']


def tiny_svg_image(label, hue):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">'
            '<rect width="320" height="180" fill="hsl(%d,45%%,40%%)"/><circle cx="160" cy="90" r="46" fill="hsl(%d,70%%,70%%)"/>'
            '<text x="160" y="172" font-size="14" text-anchor="middle" font-family="sans-serif" fill="#fff">%s</text></svg>') % (hue, (hue + 50) % 360, xml(label))


def add_media(P, filename, data, ctype):
    mid = 'm_' + secrets.token_hex(4)
    DB['media'][mid] = (data, ctype)
    m = {'id': mid, 'filename': filename, 'url': '/files/media/' + mid, 'bytes': len(data)}
    P['media'].append(m)
    return m


# ---------------------------------------------------------------- data model
def checks(errors=0, warns=0, kind='scene', idx=1):
    lines = []
    if kind == 'scene':
        if errors:
            lines += ["C4 error @5.00s: text 'HELLO' exceeds right edge by 34px",
                      "C9 error @6.20s: shape 'bar' overlaps caption by 12px"][:errors]
        if warns:
            lines += ["C2 warn @1.20s: contrast ratio 3.1 is below 4.5 for 'subtitle'"][:warns]
        if not lines:
            lines = ['C1 ok: 14 checks passed, no overflow, no overlap']
    else:
        if warns:
            lines.append('S3 warn @1.00s: onset is 40 ms later than its marker')
        lines.append('S1 ok: peak -3.0 dBFS (limit %s)' % SETTINGS['sfx_peak_dbfs'])
        lines.append('S2 ok: no clipping, no DC offset')
    return {'ok': errors == 0, 'counts': {'error': errors, 'warn': warns}, 'text': '\n'.join(lines)}


def new_project(name, fps=30, width=1920, height=1080, sfx=True, pid=None):
    pid = pid or 'p_' + secrets.token_hex(4)
    P = {'id': pid, 'name': name, 'fps': fps, 'width': width, 'height': height, 'sfx_enabled': sfx, 'status': 'setup',
         'run_mode': 'run_all', 'paused': False, 'word_count': 0, 'duration_ms': 0, 'warnings': [], 'media': [],
         'bible': None, 'plan_approved': False, 'cost_usd': 0.0,
         'beat_counts': {k: 0 for k in ('queued', 'running', 'waiting_user', 'needs_attention', 'approved', 'failed', 'skipped')},
         'running_beat_id': None, 'director_session_id': None, 'created_at': iso(),
         '_rev': 1, '_words': [], '_ready': False, '_validation': [], '_dir': None, '_pilot_done': False, '_dir_cost': 0.0}
    DB['projects'][pid] = P
    return P


def beats_of(P):
    return sorted((b for b in DB['beats'].values() if b['project_id'] == P['id']), key=lambda b: b['idx'])


def new_session(kind, pid, beat_id=None, sid=None):
    sid = sid or 's_' + secrets.token_hex(4)
    S = {'id': sid, 'kind': kind, 'beat_id': beat_id, 'status': 'idle', 'steps': 0, 'cost_usd': 0.0,
         '_pid': pid, '_messages': [], '_queue': [], '_job': None, '_replies': 0}
    DB['sessions'][sid] = S
    return S


def add_msg(S, role, text='', steps=None, queued=False):
    m = {'seq': len(S['_messages']) + 1, 'role': role, 'text': text, 'steps': steps or [], 'created_at': iso(), 'queued': queued}
    S['_messages'].append(m)
    bump(S['_pid'])
    return m


def step(name, summary, ok=True, images=None):
    return {'name': name, 'summary': summary, 'ok': ok, 'image_urls': images or []}


def ensure_words(P, count=240):
    """keep uploaded words; pad with filler so every beat has words. word_count only set when nothing was uploaded."""
    ws = [w['text'] for w in P['_words']]
    declared = not ws
    while len(ws) < count:
        ws.append(WORDS[len(ws) % len(WORDS)])
    P['_words'] = [{'id': 'w%d' % i, 'text': t, 'start_ms': i * 400, 'end_ms': i * 400 + 360} for i, t in enumerate(ws)]
    if declared:
        P['word_count'] = len(ws)
        P['duration_ms'] = len(ws) * 400


def make_beat(P, idx, n_total, status='queued'):
    words = P['_words']
    per = max(1, len(words) // n_total)
    a = (idx - 1) * per
    z = len(words) - 1 if idx == n_total else a + per - 1
    fps = P['fps']
    f0 = round(words[a]['start_ms'] * fps / 1000)
    f1 = round(words[z]['end_ms'] * fps / 1000)
    bid = '%s_b%02d' % (P['id'], idx)
    S = new_session('beat', P['id'], bid, 's_' + bid)
    b = {'id': bid, 'project_id': P['id'], 'idx': idx, 'title': TITLES[(idx - 1) % 12],
         'mode': ['technical', 'story', 'either'][idx % 3], 'direction': DIRECTIONS[(idx - 1) % 12],
         'text': ' '.join(w['text'] for w in words[a:z + 1]), 'word_from': a, 'word_to': z, 'f0': f0, 'f1': f1,
         'duration_s': round((f1 - f0) / fps, 3), 'start_tc': tc(words[a]['start_ms'] / 1000), 'status': status,
         'status_reason': None, 'summary': None, 'steps': 0, 'cost_usd': 0.0, 'session_id': S['id'], 'scene_n': None,
         'sfx_n': None, 'strip_url': None, 'updated_at': iso(),
         '_scenes': [], '_sfx': [], '_attempts': 0, '_run': None, '_forced': False}
    DB['beats'][bid] = b
    return b


def add_scene(b, created_by='agent', errors=0, warns=0):
    n = len(b['_scenes']) + 1
    b['_scenes'].append({'n': n, 'created_at': iso(), 'created_by': created_by, 'checks': checks(errors, warns, 'scene', b['idx'])})
    b['scene_n'] = n
    b['strip_url'] = strip_url(b['id'], n)
    return n


def add_sfx(b, warns=0):
    n = len(b['_sfx']) + 1
    b['_sfx'].append({'n': n, 'created_at': iso(), 'checks': checks(0, warns, 'sfx')})
    b['sfx_n'] = n
    return n


def touch(b):
    b['updated_at'] = iso()
    bump(b['project_id'])


def refresh_project(P):
    bs = beats_of(P)
    counts = {k: 0 for k in P['beat_counts']}
    for b in bs:
        counts[b['status']] += 1
    P['beat_counts'] = counts
    P['cost_usd'] = round(sum(b['cost_usd'] for b in bs) + P['_dir_cost'], 4)
    running = [b for b in bs if b['_run'] and b['_run']['kind'] == 'build'] or [b for b in bs if b['status'] == 'running']
    P['running_beat_id'] = running[0]['id'] if running else None
    if P['plan_approved'] and bs:
        done = all(b['status'] in ('approved', 'skipped') for b in bs)
        P['status'] = 'done' if done else 'building'


def beat_detail(b):
    P = DB['projects'][b['project_id']]
    d = pub(b)
    d['scene_versions'] = [{'n': s['n'], 'created_at': s['created_at'], 'created_by': s['created_by'],
                            'strip_url': strip_url(b['id'], s['n']), 'checks': s['checks'], 'is_current': s['n'] == b['scene_n']}
                           for s in reversed(b['_scenes'])]
    d['sfx_versions'] = [{'n': s['n'], 'created_at': s['created_at'], 'wav_url': '/files/sfx/%s/%d.wav' % (b['id'], s['n']),
                          'spectrogram_url': '/files/spec/%s/%d.svg' % (b['id'], s['n']), 'checks': s['checks'],
                          'is_current': s['n'] == b['sfx_n']} for s in reversed(b['_sfx'])]
    fps = P['fps']
    d['words'] = [{'id': w['id'], 'text': w['text'], 'start_ms': w['start_ms'], 'end_ms': w['end_ms'],
                   'f0': round(w['start_ms'] * fps / 1000), 'f1': round(w['end_ms'] * fps / 1000)}
                  for w in P['_words'][b['word_from']:b['word_to'] + 1]]
    return d


def session_pub(S):
    return pub(S)


BIBLE = ('# Story bible\n\n**Tone:** calm, warm, a little wry.\n\n**Palette:** paper `#F3EAD7`, ink `#221E1A`, '
         'one tomato accent `#E8452C`.\n\n**Rules**\n\n- One idea per beat; never more than 9 words on screen.\n'
         '- Numbers always count up, never pop in.\n- Sound: soft wooden ticks, no whooshes.\n\n'
         '```text\ntype: Georgia-ish serif, 96px titles, 40px captions\nmotion: ease-out, 0.4 s\n```')


def fill_plan(P, n=12):
    ensure_words(P, n * 20)
    for old in beats_of(P):
        DB['beats'].pop(old['id'], None)
        DB['sessions'].pop(old['session_id'], None)
    for i in range(1, n + 1):
        make_beat(P, i, n)
    refresh_project(P)


def seed_built_beat(b, status, versions=1, errors=0):
    for v in range(versions):
        add_scene(b, 'agent' if v == 0 else 'user', errors if v == versions - 1 else 0, 1 if (b['idx'] % 3 == 0 or (errors and v == versions - 1)) else 0)
    if DB['projects'][b['project_id']]['sfx_enabled']:
        add_sfx(b, 1 if b['idx'] % 4 == 0 else 0)
        add_sfx(b)
    b['status'] = status
    b['_attempts'] = 1
    b['steps'] = 12 + b['idx']
    b['cost_usd'] = round(0.4 + 0.05 * b['idx'], 4)
    b['summary'] = 'Built a %s scene: %s' % (b['mode'], b['direction'].lower())
    S = DB['sessions'][b['session_id']]
    S['steps'] = b['steps']
    S['cost_usd'] = b['cost_usd']
    S['status'] = {'approved': 'done', 'waiting_user': 'waiting_user', 'needs_attention': 'flagged'}.get(status, 'idle')
    add_msg(S, 'event', 'Beat agent started')
    add_msg(S, 'assistant', 'Scene **v%d** is ready. %s' % (b['scene_n'], b['summary']),
            [step('write_scene', 'wrote scene.js (%d lines)' % (60 + b['idx']), True, [strip_url(b['id'], b['scene_n'])]),
             step('run_checks', '%d errors, %d warnings' % (errors, 1 if b['idx'] % 3 == 0 else 0), errors == 0)])
    if status == 'needs_attention':
        b['status_reason'] = 'Automated checks still report 2 errors after 3 attempts.'


def seed():
    # 1. setup, empty
    new_project('Orbit Explainer', pid='p_setup')
    # 2. setup with an interpolated transcript and two images
    P = new_project('Podcast Clip (interpolated)', 25, 1280, 720, True, 'p_interp')
    ensure_words(P, 180)
    P['warnings'] = ['No word timestamps found: timings were interpolated from the speaking rate (about 150 wpm).']
    add_media(P, 'cover.svg', tiny_svg_image('cover', 20).encode(), 'image/svg+xml')
    add_media(P, 'logo.svg', tiny_svg_image('logo', 200).encode(), 'image/svg+xml')
    # 3. planning (director waiting, plan incomplete)
    P = new_project('Cooking Intro', 30, 1920, 1080, True, 'p_plan')
    ensure_words(P, 240)
    fill_plan(P)
    for b in beats_of(P)[6:]:
        DB['beats'].pop(b['id'])
        DB['sessions'].pop(b['session_id'])
    P['status'] = 'planning'
    P['_validation'] = ['Words 121-240 are not covered by any beat.', 'Beat 4 is longer than 12 s (14.2 s).']
    S = new_session('director', P['id'], None, 's_p_plan_dir')
    P['director_session_id'] = S['id']
    S['status'] = 'waiting_user'
    S['steps'] = 3
    S['cost_usd'] = 0.31
    P['_dir_cost'] = 0.31
    add_msg(S, 'event', 'Director session started')
    add_msg(S, 'assistant', 'I read the transcript (**240 words**) and drafted the first six beats.',
            [step('read_transcript', '240 words, 96 s'), step('propose_beats', '6 beats so far', True, [strip_url('p_plan_b01', 0)])])
    add_msg(S, 'user', 'Please keep the opening under 8 seconds.')
    add_msg(S, 'assistant', 'Noted. I still need to cover the second half; tell me if you want a different split.')
    # 4. plan ready
    P = new_project('History Lesson', 24, 1920, 1080, True, 'p_ready')
    ensure_words(P, 240)
    fill_plan(P)
    P['status'] = 'plan_ready'
    P['_ready'] = True
    P['bible'] = BIBLE
    S = new_session('director', P['id'], None, 's_p_ready_dir')
    P['director_session_id'] = S['id']
    S['status'] = 'waiting_user'
    S['steps'] = 5
    S['cost_usd'] = 0.52
    P['_dir_cost'] = 0.52
    add_msg(S, 'event', 'Director session started')
    add_msg(S, 'assistant', 'The plan is ready: **12 beats** and a story bible. Approve it when you are happy.',
            [step('propose_beats', '12 beats', True, [strip_url('p_ready_b01', 0)]), step('write_bible', 'bible written (14 lines)')])
    # 5. building: every beat status
    P = new_project('Product Launch', 30, 1920, 1080, True, 'p_build')
    ensure_words(P, 240)
    fill_plan(P)
    P['bible'] = BIBLE
    P['plan_approved'] = True
    P['_ready'] = True
    S = new_session('director', P['id'], None, 's_p_build_dir')
    P['director_session_id'] = S['id']
    S['status'] = 'done'
    S['cost_usd'] = 0.6
    P['_dir_cost'] = 0.6
    add_msg(S, 'assistant', 'Plan approved. Beat agents are building now.')
    add_media(P, 'logo.svg', tiny_svg_image('logo', 8).encode(), 'image/svg+xml')
    spec = {1: ('approved', 2), 2: ('approved', 1), 3: ('waiting_user', 1), 4: ('waiting_user', 2), 5: ('needs_attention', 1)}
    for b in beats_of(P):
        if b['idx'] in spec:
            seed_built_beat(b, spec[b['idx']][0], spec[b['idx']][1], 2 if b['idx'] == 5 else 0)
        elif b['idx'] == 6:
            b['status'] = 'skipped'
        elif b['idx'] == 7:
            b['status'] = 'failed'
            b['_attempts'] = 1
            b['status_reason'] = 'Agent stopped: max_steps (40) reached before the scene rendered.'
            b['steps'] = 40
            b['cost_usd'] = 1.2
        elif b['idx'] == 8:
            b['status'] = 'running'
            b['_attempts'] = 1
            b['_run'] = {'kind': 'build', 'start': now() - sd(2), 'due': now() + sd(4), 'next_step': now() + sd(0.5), 'n': 1}
            DB['sessions'][b['session_id']]['status'] = 'running'
    # 6. done
    P = new_project('Wedding Speech', 30, 1920, 1080, False, 'p_done')
    ensure_words(P, 240)
    fill_plan(P)
    P['bible'] = BIBLE
    P['plan_approved'] = True
    P['_ready'] = True
    S = new_session('director', P['id'], None, 's_p_done_dir')
    P['director_session_id'] = S['id']
    S['status'] = 'done'
    add_msg(S, 'assistant', 'All beats are approved.')
    for b in beats_of(P):
        seed_built_beat(b, 'approved', 1 + b['idx'] % 2)
    P['_dir_cost'] = 0.7
    ex = {'id': 'e_seed', 'status': 'done', 'progress': {'done': 12, 'total': 12}, 'error': None, 'files': [],
          'zip_url': None, 'manifest_url': None, 'expires_at': iso(now() - 3600), 'created_at': iso(now() - 90000),
          '_pid': P['id'], '_start': now() - 90000, '_beats': [b['id'] for b in beats_of(P)], '_expired': True}
    DB['exports']['e_seed'] = ex
    for P in DB['projects'].values():
        refresh_project(P)


# ---------------------------------------------------------------- simulation
def director_tick(P, t):
    D = P['_dir']
    if not D or D['i'] >= len(D['script']):
        return
    S = DB['sessions'][P['director_session_id']]
    elapsed = (t - D['start']) * SPEED
    while D['i'] < len(D['script']) and elapsed >= D['script'][D['i']][0]:
        kind = D['script'][D['i']][1]
        D['i'] += 1
        bump(P['id'])
        if kind == 'event':
            S['status'] = 'running'
            add_msg(S, 'event', 'Director session started')
        elif kind == 'read':
            S['steps'] += 1
            S['cost_usd'] += 0.04
            add_msg(S, 'assistant', "I've read the transcript: **%d words**, about %s. I'll split it into short beats that each carry one idea." %
                    (P['word_count'], tc(P['duration_ms'] / 1000)), [step('read_transcript', '%d words, %d s' % (P['word_count'], P['duration_ms'] // 1000))])
        elif kind == 'draft':
            fill_plan(P)
            for b in beats_of(P)[6:]:
                DB['beats'].pop(b['id'])
                DB['sessions'].pop(b['session_id'])
            P['_validation'] = ['Words 121-240 are not covered by any beat yet.']
            S['steps'] += 1
            S['cost_usd'] += 0.08
            add_msg(S, 'assistant', 'First draft: **6 beats** so far. Continuing with the second half.',
                    [step('propose_beats', '6 beats', True, [strip_url(beats_of(P)[0]['id'], 0)])])
        elif kind == 'more':
            fill_plan(P)
            P['_validation'] = []
            S['steps'] += 1
            S['cost_usd'] += 0.08
            add_msg(S, 'assistant', 'All **12 beats** now cover the whole transcript. Writing the bible next.',
                    [step('propose_beats', '12 beats', True, [strip_url(beats_of(P)[6]['id'], 0)])])
        elif kind == 'bible':
            P['bible'] = BIBLE
            S['steps'] += 1
            S['cost_usd'] += 0.05
            add_msg(S, 'assistant', 'Story bible written. A taste of the rules:\n\n```text\nmax 9 words on screen\nnumbers count up\n```',
                    [step('write_bible', 'bible written (14 lines)')])
        elif kind == 'ready':
            S['status'] = 'waiting_user'
            P['status'] = 'plan_ready'
            P['_ready'] = True
            add_msg(S, 'assistant', 'The plan is ready. Review it on the right, ask me for changes, or **approve** to start building.')
        P['_dir_cost'] = S['cost_usd']
        refresh_project(P)


def build_step_messages(b, S, run):
    names = [('read_direction', 'read the direction and the bible'), ('write_scene', 'wrote scene.js'),
             ('render_frames', 'rendered 4 preview frames'), ('run_checks', 'ran 14 automated checks'),
             ('compose_sfx', 'mixed the sound effects')]
    nm, summ = names[min(run['n'], len(names) - 1)]
    imgs = [strip_url(b['id'], len(b['_scenes']) + 1)] if nm in ('write_scene', 'render_frames') else []
    add_msg(S, 'assistant', '', [step(nm, summ, True, imgs)])
    run['n'] += 1
    b['steps'] += 1
    b['cost_usd'] = round(b['cost_usd'] + 0.03, 4)
    S['steps'] = b['steps']
    S['cost_usd'] = b['cost_usd']


def finish_build(P, b, t):
    S = DB['sessions'][b['session_id']]
    b['_run'] = None
    b['_attempts'] += 1
    sfx_on = P['sfx_enabled']
    if b['idx'] == 9 and b['_attempts'] == 1:
        b['status'] = 'failed'
        b['status_reason'] = 'Agent stopped: max_steps (40) reached before the scene rendered.'
        S['status'] = 'failed'
        add_msg(S, 'event', 'Run failed: max_steps reached')
    elif b['idx'] == 5 and b['_attempts'] == 1:
        add_scene(b, 'agent', 2, 1)
        if sfx_on:
            add_sfx(b)
        b['status'] = 'needs_attention'
        b['status_reason'] = 'Automated checks still report 2 errors after 3 attempts.'
        b['summary'] = 'Scene built but the title overflows on the right edge.'
        S['status'] = 'flagged'
        add_msg(S, 'assistant', 'I could not fix the overflow: `HELLO` is **34px** too wide. Tell me which font to use.',
                [step('run_checks', '2 errors, 1 warning', False)])
    else:
        add_scene(b, 'agent', 0, 1 if b['idx'] % 3 == 0 else 0)
        if sfx_on:
            add_sfx(b, 1 if b['idx'] % 4 == 0 else 0)
        b['status'] = 'waiting_user'
        b['status_reason'] = None
        b['summary'] = 'Built a %s scene: %s' % (b['mode'], b['direction'].lower())
        S['status'] = 'waiting_user'
        add_msg(S, 'assistant', 'Scene **v%d** is ready for review. %s' % (b['scene_n'], b['summary']))
    touch(b)
    if P['run_mode'] == 'pilot' and not P['_pilot_done'] and b['idx'] == 1:
        P['_pilot_done'] = True
        P['paused'] = True


def build_tick(P, t):
    if not P['plan_approved']:
        return
    bs = beats_of(P)
    building = [b for b in bs if b['_run'] and b['_run']['kind'] == 'build']
    for b in building:
        run, S = b['_run'], DB['sessions'][b['session_id']]
        while run['n'] < 5 and t >= run['next_step']:
            build_step_messages(b, S, run)
            run['next_step'] += sd(1.2)
            touch(b)
        if t >= run['due']:
            finish_build(P, b, t)
    if not any(b['_run'] and b['_run']['kind'] == 'build' for b in beats_of(P)):
        forced = [b for b in bs if b['status'] == 'queued' and b['_forced']]
        nxt = forced[0] if forced else (None if P['paused'] else next((b for b in bs if b['status'] == 'queued'), None))
        if nxt:
            nxt['_forced'] = False
            nxt['status'] = 'running'
            nxt['status_reason'] = None
            nxt['_run'] = {'kind': 'build', 'start': t, 'due': t + sd(6), 'next_step': t + sd(0.8), 'n': 0}
            S = DB['sessions'][nxt['session_id']]
            S['status'] = 'running'
            add_msg(S, 'event', 'Beat agent started (attempt %d)' % (nxt['_attempts'] + 1))
            touch(nxt)
    refresh_project(P)


def session_tick(S, t):
    P = DB['projects'].get(S['_pid'])
    if not P:
        return
    job = S['_job']
    if job and t >= job['due']:
        S['_job'] = None
        complete_reply(P, S, job)
    elif not job and S['_queue'] and S['status'] not in ('queued', 'running'):
        seq = S['_queue'].pop(0)
        m = S['_messages'][seq - 1]
        m['queued'] = False
        S['status'] = 'running'
        if S['kind'] == 'beat':
            b = DB['beats'][S['beat_id']]
            b['status'] = 'running'
            b['status_reason'] = None
            b['_run'] = {'kind': 'feedback', 'start': t}
            touch(b)
        S['_job'] = {'due': t + sd(5 if S['kind'] == 'beat' else 2.5), 'msg': m}
        bump(P['id'])


def complete_reply(P, S, job):
    user_text = job['msg']['text']
    S['_replies'] += 1
    S['steps'] += 2
    S['cost_usd'] = round(S['cost_usd'] + 0.12, 4)
    if S['kind'] == 'director':
        bs = beats_of(P)
        if bs and not P['plan_approved']:
            b = bs[S['_replies'] % len(bs)]
            old, b['title'] = b['title'], ALT_TITLES[S['_replies'] % len(ALT_TITLES)]
            touch(b)
            add_msg(S, 'assistant', 'Done. I renamed beat %d to **%s** based on your note.\n\n```text\n%s\n```\n\nUsing `rename_beat`.' %
                    (b['idx'], b['title'], user_text[:300]), [step('rename_beat', 'beat %d: %s -> %s' % (b['idx'], old, b['title']))])
        else:
            add_msg(S, 'assistant', 'Got it. Note: the plan changes only before approval.\n\n```text\n%s\n```' % user_text[:300])
        S['status'] = 'waiting_user'
        P['_dir_cost'] = S['cost_usd']
    else:
        b = DB['beats'][S['beat_id']]
        b['_run'] = None
        sound = 'sound' in user_text.lower()
        if sound and P['sfx_enabled']:
            n = add_sfx(b)
            what, imgs = 'new sound effects (v%d)' % n, []
        else:
            n = add_scene(b, 'agent', 0, 0)
            what, imgs = 'scene v%d' % n, [strip_url(b['id'], n)]
        b['status'] = 'waiting_user'
        b['steps'] += 3
        b['cost_usd'] = round(b['cost_usd'] + 0.12, 4)
        b['summary'] = 'Applied your feedback: ' + user_text[:80]
        S['status'] = 'waiting_user'
        add_msg(S, 'assistant', 'Updated: **%s**.\n\n```text\n%s\n```' % (what, user_text[:300]),
                [step('write_scene' if not sound else 'compose_sfx', what, True, imgs), step('run_checks', '0 errors, 0 warnings')])
        touch(b)
    bump(P['id'])
    refresh_project(P)


def fake_mp4(idx):
    return b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom' + bytes([idx % 251]) * (20000 + idx * 1500)


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'beat'


def export_files(E):
    P = DB['projects'][E['_pid']]
    files = []
    for bid in E['_beats']:
        b = DB['beats'].get(bid)
        if b:
            name = 'beat_%02d_%s.mp4' % (b['idx'], slug(b['title']))
            files.append({'beat_idx': b['idx'], 'title': b['title'], 'name': name, 'bytes': len(fake_mp4(b['idx'])),
                          'url': '/files/export/%s/%s' % (E['id'], name)})
    return P, files


def export_tick(E, t):
    if E['status'] in ('done', 'failed'):
        return
    el = (t - E['_start']) * SPEED
    total = E['progress']['total']
    E['status'] = 'running' if el > 0.5 else 'queued'
    E['progress']['done'] = min(total, int(max(0, el - 0.5) / 5.5 * total))
    if el >= 6:
        P, files = export_files(E)
        E.update(status='done', files=files, progress={'done': total, 'total': total},
                 zip_url='/files/export/%s/vbeat-%s.zip' % (E['id'], slug(P['name'])),
                 manifest_url='/files/export/%s/manifest.json' % E['id'], expires_at=iso(t + 86400))
    bump(E['_pid'])


def engine():
    while True:
        time.sleep(0.2)
        try:
            with LOCK:
                if SETTINGS['kill_switch']:
                    continue
                t = now()
                for P in list(DB['projects'].values()):
                    director_tick(P, t)
                    build_tick(P, t)
                for S in list(DB['sessions'].values()):
                    session_tick(S, t)
                for E in list(DB['exports'].values()):
                    export_tick(E, t)
        except Exception as e:  # keep the simulation alive
            print('engine error:', repr(e), file=sys.stderr)


# ---------------------------------------------------------------- request context
class Ctx:
    def __init__(self, handler, method, path, query, body, m):
        self.h, self.method, self.path, self.query, self.raw, self.m = handler, method, path, query, body, m

    def json(self):
        if not self.raw:
            return {}
        try:
            v = json.loads(self.raw.decode('utf-8'))
        except ValueError:
            raise HttpError(400, 'bad_json', 'Request body is not valid JSON')
        return v if isinstance(v, dict) else {}

    def upload(self):
        ctype = self.h.headers.get('Content-Type', '')
        if 'multipart/form-data' not in ctype:
            raise HttpError(400, 'bad_upload', 'Expected multipart/form-data')
        msg = BytesParser(policy=email_default).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + self.raw)
        for part in msg.iter_parts():
            if part.get_param('name', header='content-disposition') == 'file':
                return unquote(part.get_filename() or 'upload.bin'), part.get_payload(decode=True) or b'', part.get_content_type()
        raise HttpError(400, 'bad_upload', 'Missing multipart field "file"')


ROUTES = []


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile('^' + pattern + '$'), fn))
        return fn
    return deco


def get_project(pid):
    P = DB['projects'].get(pid)
    if not P:
        raise HttpError(404, 'not_found', 'Project not found')
    return P


def get_beat(bid):
    b = DB['beats'].get(bid)
    if not b:
        raise HttpError(404, 'not_found', 'Beat not found')
    return b


def project_out(P):
    refresh_project(P)
    return pub(P)


# ---------------------------------------------------------------- API
@route('POST', '/api/login')
def api_login(c):
    if c.json().get('password') != PASSWORD:
        raise HttpError(401, 'bad_password', 'Wrong password')
    tok = secrets.token_hex(16)
    AUTH.add(tok)
    return 204, None, {'Set-Cookie': 'vbeat_sid=%s; HttpOnly; Path=/; SameSite=Lax' % tok}


@route('POST', '/api/logout')
def api_logout(c):
    AUTH.clear()
    return 204, None, {'Set-Cookie': 'vbeat_sid=; HttpOnly; Path=/; Max-Age=0'}


@route('GET', '/api/me')
def api_me(c):
    return 200, {'ok': True}


@route('GET', '/api/projects')
def api_projects(c):
    return 200, [project_out(P) for P in sorted(DB['projects'].values(), key=lambda p: p['created_at'], reverse=True)]


@route('POST', '/api/projects')
def api_project_create(c):
    b = c.json()
    name = str(b.get('name') or '').strip()
    if not name:
        raise HttpError(400, 'invalid', 'Name is required')
    fps, w, h = b.get('fps', 30), b.get('width', 1920), b.get('height', 1080)
    if fps not in (24, 25, 30, 60) or not isinstance(w, int) or not isinstance(h, int):
        raise HttpError(400, 'invalid', 'fps must be 24, 25, 30 or 60 and size must be integers')
    P = new_project(name[:80], fps, w, h, bool(b.get('sfx_enabled', True)))
    return 200, project_out(P)


@route('GET', '/api/projects/([\\w-]+)')
def api_project(c):
    return 200, project_out(get_project(c.m[0]))


@route('DELETE', '/api/projects/([\\w-]+)')
def api_project_delete(c):
    P = get_project(c.m[0])
    for b in beats_of(P):
        DB['beats'].pop(b['id'], None)
        DB['sessions'].pop(b['session_id'], None)
    DB['sessions'].pop(P['director_session_id'], None)
    DB['projects'].pop(P['id'])
    return 204, None


def parse_transcript(name, data):
    ext = os.path.splitext(name)[1].lower()
    if ext not in ('.json', '.srt', '.vtt', '.txt'):
        raise HttpError(400, 'unsupported_format', 'Use .json, .srt, .vtt or .txt')
    text = data.decode('utf-8', 'replace')
    warnings = []
    if ext == '.json':
        try:
            j = json.loads(text)
            items = j.get('words', j) if isinstance(j, dict) else j
            words = [str(w.get('text') or w.get('word') or '') if isinstance(w, dict) else str(w) for w in items]
        except (ValueError, AttributeError, TypeError):
            raise HttpError(400, 'bad_transcript', 'Could not read the JSON transcript')
        fmt = 'json'
    elif ext in ('.srt', '.vtt'):
        body = re.sub(r'(?m)^\s*(WEBVTT.*|\d+)\s*$', '', text)
        body = re.sub(r'\d\d:\d\d(:\d\d)?[.,]\d+\s*-->\s*\d\d:\d\d(:\d\d)?[.,]\d+.*', '', body)
        words = body.split()
        fmt = ext[1:]
        warnings.append('Cue timings only: word timestamps were interpolated inside each cue.')
    else:
        words = text.split()
        fmt = 'txt'
        warnings.append('No word timestamps found: timings were interpolated from the speaking rate (about 150 wpm).')
    words = [w for w in words if w]
    if not words:
        raise HttpError(400, 'empty_transcript', 'The transcript has no words')
    return fmt, words, warnings


@route('POST', '/api/projects/([\\w-]+)/transcript')
def api_transcript(c):
    P = get_project(c.m[0])
    if P['plan_approved']:
        raise HttpError(409, 'plan_approved', 'The plan is approved; the transcript is locked')
    name, data, _ = c.upload()
    fmt, words, warnings = parse_transcript(name, data)
    P['_words'] = [{'id': 'w%d' % i, 'text': t, 'start_ms': i * 400, 'end_ms': i * 400 + 360} for i, t in enumerate(words)]
    P.update(word_count=len(words), duration_ms=len(words) * 400, warnings=warnings)
    bump(P['id'])
    return 200, {'format': fmt, 'word_count': len(words), 'duration_ms': len(words) * 400, 'warnings': warnings}


@route('POST', '/api/projects/([\\w-]+)/media')
def api_media(c):
    P = get_project(c.m[0])
    if P['plan_approved']:
        raise HttpError(409, 'plan_approved', 'The plan is approved; media is locked')
    name, data, ctype = c.upload()
    if not ctype.startswith('image/'):
        ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
                 '.webp': 'image/webp'}.get(os.path.splitext(name)[1].lower(), '')
    if not ctype:
        raise HttpError(400, 'unsupported_media', 'Only images are accepted')
    if len(data) > 12 * 1024 * 1024:
        raise HttpError(413, 'too_large', 'Image is larger than 12 MB')
    m = add_media(P, name, data, ctype)
    bump(P['id'])
    return 200, m


@route('DELETE', '/api/projects/([\\w-]+)/media/([\\w-]+)')
def api_media_delete(c):
    P = get_project(c.m[0])
    if P['plan_approved']:
        raise HttpError(409, 'plan_approved', 'The plan is approved; media is locked')
    before = len(P['media'])
    P['media'] = [m for m in P['media'] if m['id'] != c.m[1]]
    if len(P['media']) == before:
        raise HttpError(404, 'not_found', 'Media not found')
    DB['media'].pop(c.m[1], None)
    bump(P['id'])
    return 204, None


@route('GET', '/api/projects/([\\w-]+)/status')
def api_status(c):
    P = get_project(c.m[0])
    try:
        rev = int(c.query.get('rev', ['0'])[0])
    except ValueError:
        rev = 0
    if rev == P['_rev']:
        return 200, {'rev': P['_rev'], 'changed': False}
    return 200, {'rev': P['_rev'], 'changed': True, 'project': project_out(P), 'beats': [pub(b) for b in beats_of(P)]}


@route('POST', '/api/projects/([\\w-]+)/plan/start')
def api_plan_start(c):
    P = get_project(c.m[0])
    if P['plan_approved'] or P['director_session_id']:
        raise HttpError(409, 'already_started', 'Planning has already started')
    if not P['word_count']:
        raise HttpError(409, 'no_transcript', 'Upload a transcript first')
    S = new_session('director', P['id'])
    P['director_session_id'] = S['id']
    P['status'] = 'planning'
    S['status'] = 'queued'
    instr = str(c.json().get('instructions') or '').strip()
    if instr:
        add_msg(S, 'user', instr[:2000])
    P['_dir'] = {'start': now(), 'i': 0, 'script': [(0.4, 'event'), (1.4, 'read'), (3.0, 'draft'), (5.0, 'more'), (6.5, 'bible'), (8.0, 'ready')]}
    bump(P['id'])
    return 202, {'session_id': S['id']}


@route('GET', '/api/projects/([\\w-]+)/plan')
def api_plan(c):
    P = get_project(c.m[0])
    refresh_project(P)
    S = DB['sessions'].get(P['director_session_id'])
    return 200, {'beats': [pub(b) for b in beats_of(P)], 'bible': P['bible'], 'validation': list(P['_validation']),
                 'ready': bool(P['_ready']), 'approved': P['plan_approved'], 'session': session_pub(S) if S else None}


@route('POST', '/api/projects/([\\w-]+)/plan/approve')
def api_plan_approve(c):
    P = get_project(c.m[0])
    mode = c.json().get('run_mode', 'run_all')
    if mode not in ('run_all', 'pilot'):
        raise HttpError(400, 'invalid', 'run_mode must be run_all or pilot')
    if not P['_ready'] or P['_validation'] or P['plan_approved']:
        raise HttpError(409, 'not_ready', 'The plan is not ready to approve')
    P.update(plan_approved=True, run_mode=mode, paused=False, status='building', _pilot_done=False)
    for b in beats_of(P):
        b['status'] = 'queued'
    S = DB['sessions'][P['director_session_id']]
    S['status'] = 'done'
    add_msg(S, 'event', 'Plan approved (%s)' % ('pilot: pausing after beat 1' if mode == 'pilot' else 'run all'))
    return 200, project_out(P)


@route('POST', '/api/projects/([\\w-]+)/run/pause')
def api_pause(c):
    P = get_project(c.m[0])
    P['paused'] = True
    bump(P['id'])
    return 200, project_out(P)


@route('POST', '/api/projects/([\\w-]+)/run/resume')
def api_resume(c):
    P = get_project(c.m[0])
    P['paused'] = False
    P['_pilot_done'] = True
    bump(P['id'])
    return 200, project_out(P)


@route('GET', '/api/sessions/([\\w-]+)/messages')
def api_messages(c):
    S = DB['sessions'].get(c.m[0])
    if not S:
        raise HttpError(404, 'not_found', 'Session not found')
    try:
        after = int(c.query.get('after_seq', ['0'])[0])
    except ValueError:
        after = 0
    return 200, {'session': session_pub(S), 'messages': [m for m in S['_messages'] if m['seq'] > after]}


@route('POST', '/api/sessions/([\\w-]+)/messages')
def api_send(c):
    S = DB['sessions'].get(c.m[0])
    if not S:
        raise HttpError(404, 'not_found', 'Session not found')
    text = str(c.json().get('text') or '').strip()
    if not text:
        raise HttpError(400, 'invalid', 'Message is empty')
    busy = S['status'] in ('queued', 'running') or bool(S['_queue'])
    m = add_msg(S, 'user', text[:4000], queued=busy)
    S['_queue'].append(m['seq'])
    if S['status'] in ('idle', 'done', 'waiting_user', 'flagged', 'failed'):
        pass  # picked up by the next tick
    return 202, {'message': m}


@route('GET', '/api/beats/([\\w-]+)')
def api_beat(c):
    return 200, beat_detail(get_beat(c.m[0]))


@route('POST', '/api/beats/([\\w-]+)/approve')
def api_beat_approve(c):
    b = get_beat(c.m[0])
    if b['status'] not in ('waiting_user', 'needs_attention', 'approved'):
        raise HttpError(409, 'conflict', 'Only a beat waiting for review can be approved')
    b['status'], b['status_reason'] = 'approved', None
    DB['sessions'][b['session_id']]['status'] = 'done'
    touch(b)
    refresh_project(DB['projects'][b['project_id']])
    return 200, beat_detail(b)


@route('POST', '/api/beats/([\\w-]+)/revert')
def api_beat_revert(c):
    b = get_beat(c.m[0])
    body = c.json()
    if body.get('scene_n') is not None:
        if not any(s['n'] == body['scene_n'] for s in b['_scenes']):
            raise HttpError(404, 'not_found', 'No such scene version')
        b['scene_n'] = body['scene_n']
        b['strip_url'] = strip_url(b['id'], b['scene_n'])
    if body.get('sfx_n') is not None:
        if not any(s['n'] == body['sfx_n'] for s in b['_sfx']):
            raise HttpError(404, 'not_found', 'No such sound version')
        b['sfx_n'] = body['sfx_n']
    if b['status'] == 'approved':
        b['status'] = 'waiting_user'
    touch(b)
    refresh_project(DB['projects'][b['project_id']])
    return 200, beat_detail(b)


@route('POST', '/api/beats/([\\w-]+)/retry')
def api_beat_retry(c):
    b = get_beat(c.m[0])
    if b['status'] not in ('needs_attention', 'failed', 'skipped', 'waiting_user'):
        raise HttpError(409, 'conflict', 'This beat cannot be retried right now')
    b['status'], b['_forced'], b['status_reason'] = 'queued', True, None
    touch(b)
    refresh_project(DB['projects'][b['project_id']])
    return 202, beat_detail(b)


@route('POST', '/api/beats/([\\w-]+)/skip')
def api_beat_skip(c):
    b = get_beat(c.m[0])
    if b['status'] in ('running',):
        raise HttpError(409, 'conflict', 'Wait for the running beat to finish before skipping it')
    b['status'], b['_forced'], b['status_reason'] = 'skipped', False, None
    touch(b)
    refresh_project(DB['projects'][b['project_id']])
    return 200, beat_detail(b)


@route('GET', '/api/beats/([\\w-]+)/preview')
def api_preview(c):
    b = get_beat(c.m[0])
    P = DB['projects'][b['project_id']]
    if not b['scene_n']:
        raise HttpError(404, 'no_scene', 'This beat has no scene yet')
    dur = b['duration_s']
    frames = int(round(dur * P['fps']))
    first = P['media'][0]['url'] if P['media'] else None
    spec = {'title': b['title'], 'idx': b['idx'], 'hue': (b['idx'] * 47) % 360, 'fps': P['fps'], 'frames': frames, 'dur': dur,
            'width': 960, 'height': 540, 'markers': markers_for(dur), 'logo_url': first, 'crash_at': 5.0 if b['idx'] == 5 else None,
            'words': [w['text'] for w in P['_words'][b['word_from']:b['word_to'] + 1]][:12]}
    wav = '/files/sfx/%s/%d.wav' % (b['id'], b['sfx_n']) if (P['sfx_enabled'] and b['sfx_n']) else None
    return 200, {'fps': P['fps'], 'frames': frames, 'dur': dur, 'width': 960, 'height': 540, 'runtime_url': '/runtime/runtime.js',
                 'assets_base_url': '/runtime/assets/', 'scene_url': '/preview/scene/%s/%d.js' % (b['id'], b['scene_n']),
                 'spec': spec, 'media': {m['id']: m['url'] for m in P['media']}, 'wav_url': wav}


@route('POST', '/api/projects/([\\w-]+)/exports')
def api_export_create(c):
    P = get_project(c.m[0])
    ids = c.json().get('beat_ids') or []
    ids = [i for i in ids if i in DB['beats'] and DB['beats'][i]['project_id'] == P['id']]
    if not ids:
        raise HttpError(400, 'invalid', 'Select at least one beat')
    E = {'id': 'e_' + secrets.token_hex(4), 'status': 'queued', 'progress': {'done': 0, 'total': len(ids)}, 'error': None, 'files': [],
         'zip_url': None, 'manifest_url': None, 'expires_at': None, 'created_at': iso(), '_pid': P['id'], '_start': now(), '_beats': ids}
    DB['exports'][E['id']] = E
    bump(P['id'])
    return 202, pub(E)


@route('GET', '/api/projects/([\\w-]+)/exports')
def api_exports(c):
    P = get_project(c.m[0])
    return 200, [pub(e) for e in sorted(DB['exports'].values(), key=lambda e: e['created_at'], reverse=True) if e['_pid'] == P['id']]


@route('GET', '/api/exports/([\\w-]+)')
def api_export(c):
    E = DB['exports'].get(c.m[0])
    if not E:
        raise HttpError(404, 'not_found', 'Export not found')
    return 200, pub(E)


@route('GET', '/api/models')
def api_models(c):
    return 200, MODELS


def settings_out():
    spend = sum(P['cost_usd'] for P in DB['projects'].values())
    return dict(json.loads(json.dumps(SETTINGS)), spend_today_usd=round(spend, 2))


@route('GET', '/api/settings')
def api_settings(c):
    return 200, settings_out()


@route('PUT', '/api/settings')
def api_settings_put(c):
    b = c.json()
    ids = {m['id'] for m in MODELS}
    for k, v in (b.get('models') or {}).items():
        if k in ('director', 'beat'):
            if v not in ids:
                raise HttpError(400, 'invalid', 'Unknown model ' + str(v))
            SETTINGS['models'][k] = v
    for k, v in (b.get('caps') or {}).items():
        if k in SETTINGS['caps']:
            if not isinstance(v, (int, float)) or v < 0:
                raise HttpError(400, 'invalid', 'Caps must be positive numbers')
            SETTINGS['caps'][k] = v
    if 'beat_concurrency' in b:
        if b['beat_concurrency'] not in (1, 2, 3, 4):
            raise HttpError(400, 'invalid', 'beat_concurrency must be between 1 and 4')
        SETTINGS['beat_concurrency'] = b['beat_concurrency']
    if 'sfx_peak_dbfs' in b:
        if not isinstance(b['sfx_peak_dbfs'], (int, float)) or not -12 <= b['sfx_peak_dbfs'] <= -1:
            raise HttpError(400, 'invalid', 'sfx_peak_dbfs must be between -12 and -1')
        SETTINGS['sfx_peak_dbfs'] = b['sfx_peak_dbfs']
    return 200, settings_out()


@route('POST', '/api/kill')
def api_kill(c):
    SETTINGS['kill_switch'] = bool(c.json().get('on'))
    return 200, settings_out()


# ---------------------------------------------------------------- files, preview assets, static
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
        '.ico': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.zip': 'application/zip'}

# What a sandboxed (opaque-origin) iframe needs; see docs/BACKEND_NEEDS.md. Sent on every static/file response.
CORS = {'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges', 'X-Content-Type-Options': 'nosniff'}
FRAME_CSP = ("sandbox allow-scripts; default-src 'none'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
             "connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'")
IMMUTABLE = 'public, max-age=31536000, immutable'


def scene_js(b, n):
    crash = ("if (t >= %s) throw new Error(\"C4: text 'HELLO' exceeds right edge by 34px (scene v%d, t=\" + t.toFixed(2) + \"s)\");\n" % (5.0, n)) if b['idx'] == 5 else ''
    return ("// mock scene for beat %d v%d (AI-written scene code would live here)\n"
            "export const name = %s;\n"
            "export function draw(ctx, t, w, h, spec, shapes) {\n%s"
            "  shapes.background(ctx, w, h, spec.hue, t);\n"
            "  shapes.orbs(ctx, w, h, spec.hue, t, spec.idx);\n"
            "  shapes.title(ctx, w, h, spec.title, t);\n"
            "  shapes.caption(ctx, w, h, spec.words, t, spec.dur);\n"
            "}\n") % (b['idx'], n, json.dumps(b['title']), crash)


def file_response(path):
    """returns (status, bytes, ctype, extra_headers) for dynamic /files, /preview and /runtime paths or None"""
    m = re.match(r'^/files/strip/([\w-]+)/(\d+)\.svg$', path)
    if m:
        b = DB['beats'].get(m[1])
        return (200, strip_svg(b, int(m[2])).encode(), MIME['.svg'], {'Cache-Control': 'no-cache'}) if b else None
    m = re.match(r'^/files/spec/([\w-]+)/(\d+)\.svg$', path)
    if m:
        return 200, spectrogram_svg(m[1], int(m[2])).encode(), MIME['.svg'], {'Cache-Control': IMMUTABLE}
    m = re.match(r'^/files/sfx/([\w-]+)/(\d+)\.wav$', path)
    if m:
        b = DB['beats'].get(m[1])
        return (200, make_wav(b['duration_s'], int(m[2]), sfx_times(b)), MIME['.wav'], {'Cache-Control': IMMUTABLE}) if b else None
    m = re.match(r'^/files/media/([\w-]+)$', path)
    if m and m[1] in DB['media']:
        data, ctype = DB['media'][m[1]]
        return 200, data, ctype, {'Cache-Control': IMMUTABLE}
    m = re.match(r'^/files/export/([\w-]+)/(.+)$', path)
    if m:
        E = DB['exports'].get(m[1])
        if not E:
            return None
        if E.get('_expired') or E['status'] != 'done':
            raise HttpError(410, 'expired', 'This export has expired; export again to rebuild it')
        P, files = export_files(E)
        name = unquote(m[2])
        hdr = {'Content-Disposition': 'attachment; filename="%s"' % name, 'Cache-Control': 'no-cache'}
        if name == 'manifest.json':
            man = {'project': P['name'], 'fps': P['fps'], 'width': P['width'], 'height': P['height'],
                   'files': [{'beat_idx': f['beat_idx'], 'title': f['title'], 'name': f['name'], 'bytes': f['bytes']} for f in files]}
            return 200, json.dumps(man, indent=2).encode(), MIME['.json'], hdr
        if name.endswith('.zip'):
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
                for f in files:
                    z.writestr(f['name'], fake_mp4(f['beat_idx']))
                z.writestr('manifest.json', json.dumps({'project': P['name']}))
            return 200, out.getvalue(), MIME['.zip'], hdr
        for f in files:
            if f['name'] == name:
                return 200, fake_mp4(f['beat_idx']), MIME['.mp4'], hdr
        return None
    m = re.match(r'^/preview/scene/([\w-]+)/(\d+)\.js$', path)
    if m:
        b = DB['beats'].get(m[1])
        return (200, scene_js(b, int(m[2])).encode(), MIME['.js'], {'Cache-Control': IMMUTABLE}) if b else None
    if path.startswith('/runtime/'):
        return static_file(RUNTIME_DIR, path[len('/runtime/'):], {'Cache-Control': 'no-cache'})
    return None


def static_file(root, rel, extra=None):
    rel = unquote(rel).lstrip('/') or 'index.html'
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
        return None
    with open(full, 'rb') as f:
        data = f.read()
    hdr = {'Cache-Control': 'no-cache'}
    hdr.update(extra or {})
    return 200, data, MIME.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'), hdr


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'vbeat-mock'

    def log_message(self, *a):
        pass

    def send_all(self, status, body, ctype=None, extra=None, head=False):
        data = body if isinstance(body, bytes) else b''
        rng = self.headers.get('Range')
        hdr = dict(extra or {})
        if rng and status == 200 and ctype == MIME['.wav'] and data:
            mm = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
            if mm and (mm[1] or mm[2]):
                if mm[1]:
                    s = int(mm[1])
                    e = int(mm[2]) if mm[2] else len(data) - 1
                else:
                    s, e = max(0, len(data) - int(mm[2])), len(data) - 1
                e = min(e, len(data) - 1)
                if s > e:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % len(data))
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                hdr['Content-Range'] = 'bytes %d-%d/%d' % (s, e, len(data))
                status, total, data = 206, len(data), data[s:e + 1]
        if ctype == MIME['.wav']:
            hdr['Accept-Ranges'] = 'bytes'
        self.send_response(status)
        if ctype:
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        for k, v in hdr.items():
            self.send_header(k, v)
        self.end_headers()
        if not head and status != 204:
            self.wfile.write(data)

    def send_json(self, status, obj, extra=None):
        if obj is None:
            return self.send_all(status, b'', None, extra)
        return self.send_all(status, json.dumps(obj).encode(), 'application/json', dict({'Cache-Control': 'no-store'}, **(extra or {})))

    def handle_any(self, method):
        head = method == 'HEAD'
        if head:
            method = 'GET'
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n) if n else b''
        u = urlparse(self.path)
        path, query = u.path, parse_qs(u.query)
        try:
            if path.startswith('/__test/'):
                return self.test_hook(path, query)
            if time.time() < COLD_UNTIL:
                return self.send_json(503, {'error': {'code': 'cold_start', 'message': 'Server is waking up'}})
            if method == 'OPTIONS':
                return self.send_all(204, b'', None, dict(CORS, **{'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'}))
            if path.startswith('/api/'):
                return self.api(method, path, query, raw)
            if method != 'GET':
                raise HttpError(405, 'method_not_allowed', 'Method not allowed')
            with LOCK:
                r = file_response(path) if path.startswith(('/files/', '/preview/', '/runtime/')) else None
            if r is None and not path.startswith(('/files/', '/preview/', '/runtime/')):
                extra = {'Content-Security-Policy': FRAME_CSP} if path == '/preview-frame.html' else None
                r = static_file(WEB, path, extra)
                if r is None and path == '/favicon.ico':
                    r = static_file(WEB, 'assets/favicon.svg')
            if r is None:
                raise HttpError(404, 'not_found', 'Not found')
            status, data, ctype, hdr = r
            return self.send_all(status, data, ctype, dict(CORS, **hdr), head)
        except HttpError as e:
            return self.send_json(e.status, {'error': {'code': e.code, 'message': e.message}})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # pragma: no cover
            print('handler error:', repr(e), file=sys.stderr)
            return self.send_json(500, {'error': {'code': 'internal', 'message': 'Mock server error: %r' % (e,)}})

    def api(self, method, path, query, raw):
        for meth, rx, fn in ROUTES:
            m = rx.match(path)
            if m and meth == method:
                if path != '/api/login':
                    cookie = self.headers.get('Cookie', '')
                    tok = re.search(r'vbeat_sid=([0-9a-f]+)', cookie)
                    if not tok or tok[1] not in AUTH:
                        raise HttpError(401, 'unauthorized', 'Please log in')
                with LOCK:
                    res = fn(Ctx(self, method, path, query, raw, m.groups()))
                status, obj = res[0], res[1]
                return self.send_json(status, obj, res[2] if len(res) > 2 else None)
        if any(rx.match(path) for _, rx, _ in ROUTES):
            raise HttpError(405, 'method_not_allowed', 'Method not allowed')
        raise HttpError(404, 'not_found', 'Unknown endpoint')

    def test_hook(self, path, query):
        global COLD_UNTIL
        if path == '/__test/expire':
            AUTH.clear()
        elif path == '/__test/cold':
            COLD_UNTIL = time.time() + float(query.get('s', ['5'])[0])
        return self.send_json(200, {'ok': True})

    do_GET = lambda self: self.handle_any('GET')
    do_HEAD = lambda self: self.handle_any('HEAD')
    do_POST = lambda self: self.handle_any('POST')
    do_PUT = lambda self: self.handle_any('PUT')
    do_DELETE = lambda self: self.handle_any('DELETE')
    do_OPTIONS = lambda self: self.handle_any('OPTIONS')


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ConnectionError, BrokenPipeError)):
            super().handle_error(request, client_address)


def main():
    global SPEED, COLD_UNTIL
    ap = argparse.ArgumentParser(description='vbeat mock server (contract v1)')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8000, help='0 picks a free port')
    ap.add_argument('--speed', type=float, default=1.0, help='run simulated timers N times faster')
    ap.add_argument('--cold-start', type=float, default=0.0, metavar='N', help='answer 503 to every request for the first N seconds')
    a = ap.parse_args()
    SPEED = max(0.1, a.speed)
    COLD_UNTIL = time.time() + a.cold_start
    seed()
    threading.Thread(target=engine, daemon=True).start()
    srv = Server((a.host, a.port), Handler)
    print('vbeat mock listening on http://%s:%d  (password: %s, speed x%g)' % (a.host, srv.server_address[1], PASSWORD, SPEED), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
