#!/usr/bin/env python3
"""vbeat end-to-end tests (Playwright for Python) against the mock server.

    python tests/e2e.py              # static scan + mobile + desktop (in parallel) + cold start
    python tests/e2e.py --only mobile
    python tests/e2e.py --headed

Needs: pip install playwright && playwright install chromium   (or an installed Chrome: set VBEAT_CHROME_CHANNEL=chrome)
Each viewport pass starts its own mock server (fresh state) on a free port at --speed 3.
Screenshots of every screen are written to docs/screens/.
"""
import argparse
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
import io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'docs' / 'screens'
VIEWPORTS = {'mobile': {'width': 390, 'height': 844}, 'desktop': {'width': 1280, 'height': 800}}
CHANNEL = os.environ.get('VBEAT_CHROME_CHANNEL', '')


# ------------------------------------------------------------------ helpers
def start_server(*args):
    proc = subprocess.Popen([sys.executable, str(ROOT / 'mock' / 'server.py'), '--port', '0', *args], stdout=subprocess.PIPE, text=True)
    line = proc.stdout.readline()
    m = re.search(r':(\d+)\s', line)
    if not m:
        proc.kill()
        raise RuntimeError('mock server did not start: ' + line)
    return proc, int(m.group(1))


def launch(p, headed=False):
    kw = {'headless': not headed, 'args': ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']}
    if CHANNEL:
        kw['channel'] = CHANNEL
    try:
        return p.chromium.launch(**kw)
    except Exception:
        kw['channel'] = 'chrome'  # fall back to an installed Chrome
        return p.chromium.launch(**kw)


class Session:
    """one browser page + console error bookkeeping"""

    def __init__(self, browser, base, name, vp, scheme='light'):
        self.name, self.base = name, base
        self.ctx = browser.new_context(viewport=vp, color_scheme=scheme, accept_downloads=True)
        self.page = self.ctx.new_page()
        self.errors, self.tolerated, self._tol = [], [], 0
        self.page.on('console', lambda m: self._log(m.text) if m.type == 'error' else None)
        self.page.on('pageerror', lambda e: self._log('PAGEERROR ' + str(e) + ' | ' + str(getattr(e, 'stack', '') or '')[:600]))

    def _log(self, text):
        (self.tolerated if self._tol else self.errors).append(text)

    def tolerate(self):
        s = self

        class C:
            def __enter__(self):
                s._tol += 1

            def __exit__(self, *a):
                s.page.wait_for_timeout(400)
                s._tol -= 1
        return C()

    def go(self, hash_):
        if self.page.url.split('#')[0].rstrip('/') == self.base.rstrip('/') and '#' in self.page.url:
            self.page.evaluate('h => { location.hash = h }', hash_)
        else:
            self.page.goto(self.base + hash_)

    def shot(self, name, full=True):
        if not self.name.startswith('cold'):
            self.no_hscroll(name)  # every screen that is screenshotted must also fit the width
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(SHOTS / ('%s-%s.png' % (self.name, name))), full_page=full)

    def no_hscroll(self, where):
        w = self.page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')
        assert w[0] <= w[1], '%s: horizontal scroll at %s (scrollWidth %d > %d)' % (self.name, where, w[0], w[1])

    def tap_targets(self, where):
        bad = self.page.evaluate("""() => {
          const out = [];
          for (const n of document.querySelectorAll('button, a[href], select, textarea, input:not([type=hidden]), summary')) {
            if (n.closest('[hidden]') || n.closest('dialog:not([open])')) continue;
            const t = n.type;
            if (t === 'checkbox' || t === 'radio' || n.classList.contains('sr-only') || n.closest('.pcard h3')) continue;
            if (n.closest('.pv-scrub') && t !== 'range') continue;
            const r = n.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 43.5 || r.width < 43.5) out.push((n.id || n.className || n.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (n.textContent || '').trim().slice(0, 20) + '"');
          }
          return out; }""")
        assert not bad, '%s: tap targets under 44px at %s: %s' % (self.name, where, bad[:6])

    def checks(self, where):
        self.no_hscroll(where)
        self.tap_targets(where)


def confirm(s):
    s.page.click('dialog[open] [data-confirm=ok]')


def log(name, msg):
    print('[%s] %s' % (name, msg), flush=True)


# ------------------------------------------------------------------ the main flow
def run_viewport(name, headed=False):
    from playwright.sync_api import sync_playwright, expect
    expect.set_options(timeout=25000)
    proc, port = start_server('--speed', '3')
    base = 'http://127.0.0.1:%d/' % port
    try:
        with sync_playwright() as p:
            browser = launch(p, headed)
            s = Session(browser, base, name, VIEWPORTS[name])
            pg = s.page

            # 1. login failure then success (unauthenticated: 401 console noise is expected)
            with s.tolerate():
                s.go('#/projects')
                expect(pg.locator('#pw')).to_be_visible()
                assert pg.evaluate('location.hash') == '#/login', 'unauthenticated users land on login'
                s.shot('login')
                s.checks('login')
                pg.fill('#pw', 'wrong')
                pg.click('button[type=submit]')
                expect(pg.locator('.err-text')).to_contain_text('Wrong password')
            pg.fill('#pw', 'demo')
            pg.click('button[type=submit]')
            expect(pg.locator('.pcard').first).to_be_visible()
            assert pg.evaluate('location.hash') == '#/projects'
            log(name, 'login failure + success ok')

            # 2. projects list + create project
            expect(pg.locator('.pcard')).to_have_count(6)
            for status in ('Setup', 'Planning', 'Plan ready', 'Building', 'Done'):
                assert pg.locator('.pcard .chip', has_text=status).count() >= 1, 'status chip ' + status
            s.shot('projects')
            s.checks('projects')
            pg.click('#new-project')
            pg.fill('#np-name', 'E2E project')
            assert pg.input_value('#np-fps') == '30' and pg.input_value('#np-size') == '1920x1080' and pg.is_checked('input[name=sfx]')
            s.shot('projects-new-form')
            pg.select_option('#np-fps', '25')
            pg.click('form.newform button[type=submit]')
            expect(pg.locator('#paste-text')).to_be_visible()
            pid = re.search(r'#/p/([\w-]+)/setup', pg.url).group(1)
            log(name, 'project created: ' + pid)

            # delete flow on a throwaway project
            s.go('#/projects')
            pg.click('#new-project')
            pg.fill('#np-name', 'Throwaway')
            pg.click('form.newform button[type=submit]')
            expect(pg.locator('#paste-text')).to_be_visible()
            s.go('#/projects')
            expect(pg.locator('.pcard')).to_have_count(8)
            pg.click('.pcard:has-text("Throwaway") button:has-text("Delete")')
            confirm(s)
            expect(pg.locator('.pcard')).to_have_count(7)
            assert pg.locator('.pcard:has-text("Throwaway")').count() == 0
            log(name, 'delete with confirm ok')

            # 3. setup: transcript (srt, then txt for the interpolation warning), images
            s.go('#/p/%s/setup' % pid)
            expect(pg.locator('#paste-send')).to_be_enabled()
            words = ' '.join('harbor%d' % i for i in range(300))
            srt = '1\n00:00:00,000 --> 00:02:00,000\n' + words + '\n'
            pg.set_input_files('#transcript-file', files=[{'name': 'talk.srt', 'mimeType': 'text/plain', 'buffer': srt.encode()}])
            expect(pg.locator('#parse-result')).to_contain_text('srt')
            expect(pg.locator('#parse-result')).to_contain_text('300')
            pg.fill('#paste-text', words)
            pg.click('#paste-send')
            expect(pg.locator('#parse-result [data-kind=interpolation]')).to_contain_text('Word sync will be weaker')
            expect(pg.locator('#parse-result')).to_contain_text('txt')
            png = b'\x89PNG\r\n\x1a\n' + b'\x00' * 120
            pg.set_input_files('#image-file', files=[{'name': 'one.png', 'mimeType': 'image/png', 'buffer': png}, {'name': 'two.png', 'mimeType': 'image/png', 'buffer': png}])
            expect(pg.locator('.thumb')).to_have_count(2)
            pg.click('.thumb:has-text("two.png") button.del')
            confirm(s)
            expect(pg.locator('.thumb')).to_have_count(1)
            s.shot('setup')
            s.checks('setup')
            # the uploaded image is served back (bytes round trip)
            src = pg.get_attribute('.thumb img', 'src')
            assert pg.evaluate("u => fetch(u).then(r => r.arrayBuffer()).then(b => b.byteLength)", src) == len(png)
            log(name, 'setup: transcript, interpolation note, image upload/delete ok')
            # seeded setup project shows its parse result and is not empty
            s.go('#/p/p_interp/setup')
            expect(pg.locator('#parse-result [data-kind=interpolation]')).to_be_visible()
            s.go('#/p/%s/setup' % pid)
            expect(pg.locator('#continue')).to_be_enabled()
            pg.click('#continue')

            # 4. plan flow
            expect(pg.locator('#plan-start-btn')).to_be_visible()
            s.shot('plan-start')
            s.checks('plan-start')
            pg.fill('#plan-instructions', 'Keep every beat punchy.')
            pg.click('#plan-start-btn')
            expect(pg.locator('.chat-list .msg.user')).to_contain_text('punchy')
            expect(pg.locator('.chat-list .step').first).to_be_visible()
            assert pg.locator('#approve-btn').is_disabled(), 'approve is disabled while the plan is not ready'
            if name == 'mobile':
                pg.click('.seg button[data-tab=plan]')
            expect(pg.locator('.plan-item')).to_have_count(12, timeout=40000)
            expect(pg.locator('#approve-btn')).to_be_enabled(timeout=40000)
            expect(pg.locator('#validation .validation')).to_have_count(0)
            expect(pg.locator('details.bible')).to_be_visible()
            pg.click('details.bible summary')
            expect(pg.locator('details.bible pre code')).to_contain_text('type:')  # fenced code rendered by the safe formatter
            before = pg.eval_on_selector_all('.plan-item h3', 'els => els.map(e => e.textContent)')
            if name == 'mobile':
                pg.click('.seg button[data-tab=chat]')
            pg.fill('.chat-form textarea', 'Please rename the second beat.')
            pg.press('.chat-form textarea', 'Shift+Enter')
            pg.type('.chat-form textarea', 'Thanks.')
            assert '\n' in pg.input_value('.chat-form textarea'), 'Shift+Enter inserts a newline'
            pg.press('.chat-form textarea', 'Enter')
            expect(pg.locator('.chat-list .msg.assistant', has_text='renamed beat').first).to_be_visible(timeout=30000)
            expect(pg.locator('.chat-form textarea')).to_have_value('')
            if name == 'mobile':
                pg.click('.seg button[data-tab=plan]')
            expect(pg.locator('.plan-item h3').nth(0)).to_be_visible()
            after = pg.eval_on_selector_all('.plan-item h3', 'els => els.map(e => e.textContent)')
            assert before != after, 'the Director chat changed a beat title: %s -> %s' % (before, after)
            # draft survives polling and tab changes
            if name == 'mobile':
                pg.click('.seg button[data-tab=chat]')
            pg.fill('.chat-form textarea', 'half-written draft')
            if name == 'mobile':
                pg.click('.seg button[data-tab=plan]')
                pg.click('.seg button[data-tab=chat]')
            pg.wait_for_timeout(2600)
            assert pg.input_value('.chat-form textarea') == 'half-written draft'
            s.shot('plan-chat')
            if name == 'mobile':
                s.checks('plan-chat')
                pg.click('.seg button[data-tab=plan]')
            s.shot('plan-plan')
            s.checks('plan')
            pg.check('input[value=run_all]')
            pg.click('#approve-btn')
            expect(pg.locator('dialog[open]')).to_be_visible()
            s.shot('confirm-dialog', full=False)
            confirm(s)
            expect(pg.locator('#approve-box a[href$="/beats"]')).to_be_visible()
            assert pg.locator('#approve-btn').is_hidden()
            log(name, 'plan: chat, formatter, draft, approve ok')

            # 5. beats grid updates in place while the build runs
            pg.click('#approve-box a[href$="/beats"]')
            expect(pg.locator('.bcard')).to_have_count(12)
            pg.evaluate("document.querySelector('.bcard[data-bid]').__mark = 'same-node'")
            expect(pg.locator('.bcard[data-running=true]')).to_have_count(1)
            expect(pg.locator('.bcard[data-running=true] .pulse')).to_be_visible()
            expect(pg.locator('.bcard').first.locator('.chip')).to_have_attribute('data-status', 'waiting_user')
            assert pg.evaluate("document.querySelector('.bcard[data-bid]').__mark") == 'same-node', 'cards update in place'
            expect(pg.locator('.bcard').first.locator('img.strip')).to_have_attribute('src', re.compile(r'/files/strip/'))
            s.shot('beats')
            s.checks('beats')
            # scroll position survives polling
            maxs = pg.evaluate('document.documentElement.scrollHeight - innerHeight')
            if maxs > 60:
                y = min(300, maxs - 10)
                pg.evaluate('y => window.scrollTo(0, y)', y)
                pg.wait_for_timeout(5500)
                got = pg.evaluate('window.scrollY')
                assert abs(got - y) <= 2, 'scroll jumped during polling: %s -> %s' % (y, got)
            pg.evaluate('window.scrollTo(0, 0)')
            # filters
            pg.click('.filters button[data-filter=queued]')
            assert pg.locator('.bcard:visible').count() == pg.locator('.bcard[data-status=queued]').count()
            pg.click('.filters button[data-filter=all]')
            # pause while a beat runs, then resume
            expect(pg.locator('.bcard[data-running=true]')).to_have_count(1)
            pg.click('#pause-btn')
            expect(pg.locator('#paused-chip')).to_be_visible()
            expect(pg.locator('#pause-btn')).to_have_text('Resume')
            expect(pg.locator('.bcard[data-running=true]')).to_have_count(0, timeout=20000)
            q0 = pg.locator('.bcard[data-status=queued]').count()
            pg.wait_for_timeout(3000)
            assert pg.locator('.bcard[data-status=queued]').count() == q0 and pg.locator('.bcard[data-running=true]').count() == 0, 'nothing starts while paused'
            # skip a queued beat from its card
            pg.click('.bcard:has(h3:text-is("Call to action")) button:has-text("Skip")')
            confirm(s)
            expect(pg.locator('.bcard:has(h3:text-is("Call to action"))')).to_have_attribute('data-status', 'skipped')
            pg.click('#pause-btn')
            expect(pg.locator('#paused-chip')).to_be_hidden()
            expect(pg.locator('.bcard[data-running=true]')).to_have_count(1, timeout=15000)
            log(name, 'beats: in-place updates, scroll, filter, pause/resume, skip ok')
            # needs_attention (beat 5) and failed-then-retry (beat 9)
            five = pg.locator('.bcard:has(.idx:text-is("#5"))')
            expect(five).to_have_attribute('data-status', 'needs_attention', timeout=60000)
            expect(five.locator('.reason')).to_contain_text('checks')
            nine = pg.locator('.bcard:has(.idx:text-is("#9"))')
            expect(nine).to_have_attribute('data-status', 'failed', timeout=60000)
            nine.locator('button:has-text("Retry")').click()
            expect(nine).not_to_have_attribute('data-status', 'failed')
            expect(nine).to_have_attribute('data-status', 'waiting_user', timeout=40000)
            log(name, 'needs_attention + failed->retry->waiting_user ok')

            # 6. beat page on a seeded beat (static states): preview, scrubbing, playing, sandbox
            s.go('#/b/p_build_b04')
            expect(pg.locator('#pv-slider')).to_be_enabled()
            frame_el = pg.locator('iframe.pv-frame')
            assert frame_el.get_attribute('sandbox') == 'allow-scripts', 'iframe must be sandboxed without allow-same-origin'
            assert frame_el.get_attribute('src') == '/preview-frame.html'
            fr = [f for f in pg.frames if f != pg.main_frame][0]
            assert fr.evaluate('window.origin') == 'null', 'frame has an opaque origin'
            with s.tolerate():  # the browser logs the CORS refusal
                blocked = fr.evaluate("fetch('/api/me').then(r => 'status ' + r.status, e => 'blocked')")
            assert blocked == 'blocked', 'scene code inside the sandbox cannot call the API: ' + blocked
            assert fr.evaluate("(() => { try { return typeof localStorage + document.cookie } catch (e) { return 'denied' } })()") == 'denied'
            total = int(pg.get_attribute('#pv-slider', 'max')) + 1
            expect(pg.locator('#pv-readout')).to_contain_text('frame 0 / %d' % total)
            expect(pg.locator('.pv-tick')).not_to_have_count(0)
            d0 = fr.evaluate("document.getElementById('c').toDataURL()")
            pg.fill('#pv-slider', str(total // 2))
            pg.dispatch_event('#pv-slider', 'input')
            expect(pg.locator('#pv-readout')).to_have_attribute('data-frame', str(total // 2))
            pg.wait_for_timeout(250)
            d1 = fr.evaluate("document.getElementById('c').toDataURL()")
            assert d0 != d1, 'canvas changes between two times'
            pg.click('#pv-next')
            expect(pg.locator('#pv-readout')).to_have_attribute('data-frame', str(total // 2 + 1))
            pg.click('#pv-prev')
            pg.click('#pv-prev')
            expect(pg.locator('#pv-readout')).to_have_attribute('data-frame', str(total // 2 - 1))
            # word strip: click seeks to (word.f0 - beat.f0) / fps
            words_info = pg.evaluate("document.querySelectorAll('#pv-words .w').length")
            assert words_info > 5
            pg.locator('#pv-words .w').nth(6).click()
            expect(pg.locator('#pv-words .w.cur')).to_have_count(1)
            assert pg.locator('#pv-words .w.cur').get_attribute('data-id') == 'w%d' % (int(pg.evaluate("document.querySelector('#pv-words .w').dataset.id.slice(1)")) + 6)
            f_word = int(pg.get_attribute('#pv-readout', 'data-frame'))
            assert f_word == round(6 * 0.4 * 30), 'word 6 starts at 2.4 s -> frame 72, got %d' % f_word
            # play: the audio element is the master clock
            pg.click('#pv-play')
            expect(pg.locator('.pv-stage')).to_have_attribute('data-clock', 'audio')
            pg.wait_for_timeout(1300)
            f1 = int(pg.get_attribute('#pv-readout', 'data-frame'))
            pg.click('#pv-play')
            assert 28 <= f1 - f_word <= 60, 'playing ~1.3 s advanced %d frames' % (f1 - f_word)
            f_after = pg.get_attribute('#pv-readout', 'data-frame')
            pg.wait_for_timeout(300)
            assert pg.get_attribute('#pv-readout', 'data-frame') == f_after, 'paused stays paused'
            pg.click('#pv-loop')
            pg.click('#pv-mute')
            expect(pg.locator('#pv-mute')).to_have_attribute('aria-pressed', 'true')
            s.shot('beat')
            s.checks('beat')
            log(name, 'preview: sandbox, scrub, step, words, audio clock ok')

            # error box: seeded beat 5 throws at t >= 5 s
            s.go('#/b/p_build_b05')
            expect(pg.locator('#pv-slider')).to_be_enabled()
            pg.fill('#pv-slider', '200')
            pg.dispatch_event('#pv-slider', 'input')
            expect(pg.locator('#pv-error')).to_contain_text("C4: text 'HELLO' exceeds right edge")
            expect(pg.locator('#pv-error')).to_contain_text('00:')
            pg.fill('#pv-slider', '5')
            pg.dispatch_event('#pv-slider', 'input')
            expect(pg.locator('#pv-error')).to_be_hidden()
            assert pg.locator('#checks-text .l.error').count() == 2 and pg.locator('#checks-text .l.warn').count() == 1
            expect(pg.locator('#beat-reason')).to_contain_text('2 errors')
            s.shot('beat-error')
            log(name, 'preview error box + checks colouring ok')

            # 7. feedback, revert, approve on beat 4
            s.go('#/b/p_build_b04')
            expect(pg.locator('#scene-versions .ver')).to_have_count(2)
            expect(pg.locator('#scene-versions .ver[data-current=true]')).to_have_attribute('data-n', '2')
            pg.click('#scene-versions .ver[data-n="1"] button:has-text("Use this version")')
            expect(pg.locator('#scene-versions .ver[data-n="1"]')).to_have_attribute('data-current', 'true')
            assert pg.locator('#scene-versions .ver[data-n="1"] button:has-text("Use this version")').is_disabled()
            pg.click('#scene-versions .ver[data-n="2"] button:has-text("Use this version")')
            expect(pg.locator('#scene-versions .ver[data-n="2"]')).to_have_attribute('data-current', 'true')
            expect(pg.locator('#sfx-versions .ver')).to_have_count(2)
            pg.click('#sfx-versions .ver[data-n="1"] button:has-text("Use this version")')
            expect(pg.locator('#sfx-versions .ver[data-n="1"]')).to_have_attribute('data-current', 'true')
            pg.click('#sfx-versions .ver[data-n="1"] button[aria-label^="Play sound"]')
            expect(pg.locator('#sfx-versions .ver[data-n="1"] button[aria-label^="Play sound"]')).to_contain_text('Stop')
            pg.click('#sfx-versions .ver[data-n="1"] button[aria-label^="Play sound"]')
            expect(pg.locator('#sfx-versions .ver[data-n="1"] button[aria-label^="Play sound"]')).to_contain_text('Play')
            expect(pg.locator('#sfx-versions .ver img').first).to_be_visible()
            assert 'S1' in pg.inner_text('#sfx-versions .ver[data-n="1"] pre')
            log(name, 'revert (scene + sfx) and sfx play ok')
            pg.fill('.chat-form textarea', 'Make the title larger please.')
            pg.click('.chat-form button[type=submit]')
            expect(pg.locator('.chat-list .msg.user', has_text='title larger')).to_be_visible()
            expect(pg.locator('#scene-versions .ver')).to_have_count(3, timeout=40000)
            expect(pg.locator('.beat-meta .chip[data-status=waiting_user]')).to_be_visible()
            expect(pg.locator('.chat-list .msg.assistant', has_text='Updated')).to_be_visible()
            pg.click('.quick button:has-text("Redo the sound")')
            expect(pg.locator('.chat-list .msg.user', has_text='Redo the sound effects for this beat.')).to_be_visible()
            expect(pg.locator('#sfx-versions .ver')).to_have_count(3, timeout=40000)
            log(name, 'beat feedback + "Redo the sound" ok')
            nxt = pg.get_attribute('#nav-review', 'href')
            assert nxt and nxt != '#/b/p_build_b04', 'next to review points elsewhere'
            pg.click('#approve-beat')
            expect(pg.locator('.beat-meta .chip[data-status=approved]')).to_be_visible()
            assert pg.locator('#approve-beat').is_disabled()
            pg.click('#nav-review')
            expect(pg.locator('#beat-title')).not_to_contain_text('#4 ')
            pg.click('#nav-prev')
            pg.click('#nav-next')
            log(name, 'approve + prev/next/next-to-review ok')

            # 8. export (seeded done project: all approved)
            s.go('#/p/p_done/export')
            expect(pg.locator('#export-beats input[data-bid]')).to_have_count(12)
            assert pg.locator('#export-beats input[data-bid]:checked').count() == 12, 'default selection = all approved'
            expect(pg.locator('#exports article', has_text='Expired')).to_be_visible()  # seeded expired export
            pg.uncheck('#export-all')
            assert pg.locator('#export-beats input[data-bid]:checked').count() == 0 and pg.locator('#export-start').is_disabled()
            pg.locator('#export-beats input[data-bid]').nth(0).check()
            pg.locator('#export-beats input[data-bid]').nth(1).check()
            pg.locator('#export-beats input[data-bid]').nth(2).check()
            pg.click('#export-start')
            card = pg.locator('#exports article').first
            expect(card.locator('.progress')).to_be_visible()
            expect(card.locator('[data-kind=zip]')).to_be_visible(timeout=30000)
            assert card.locator('.flist li').count() == 3
            s.shot('export')
            s.checks('export')
            href = card.locator('[data-kind=zip]').get_attribute('href')
            r = pg.request.get(base.rstrip('/') + href)
            assert r.ok and zipfile.ZipFile(io.BytesIO(r.body())).namelist()[0].endswith('.mp4'), 'zip downloads and contains mp4s'
            href = card.locator('[data-kind=manifest]').get_attribute('href')
            assert pg.request.get(base.rstrip('/') + href).json()['files'], 'manifest downloads'
            fhref = card.locator('.flist a').first.get_attribute('href')
            fr_ = pg.request.get(base.rstrip('/') + fhref)
            assert fr_.ok and len(fr_.body()) > 1000
            log(name, 'export + downloads ok')

            # 9. settings and kill switch
            s.go('#/settings')
            expect(pg.locator('#pick-director button')).not_to_have_count(0)
            s.shot('settings')
            s.checks('settings')
            pg.fill('#pick-director-search', 'no tools')
            expect(pg.locator('#pick-director button')).to_have_count(1)
            pg.click('#pick-director button')
            expect(pg.locator('#pick-director-warn')).to_contain_text('does not support tools')
            pg.fill('#pick-beat-search', 'text only')
            pg.click('#pick-beat button')
            expect(pg.locator('#pick-beat-warn')).to_contain_text('cannot read images')
            pg.click('#save-models')
            expect(pg.locator('.toast.ok', has_text='Models saved')).to_be_visible()
            pg.fill('#cap-run_usd', '12.5')
            pg.click('#save-caps')
            expect(pg.locator('.toast.ok', has_text='Caps saved')).to_be_visible()
            pg.fill('#beat-concurrency', '2')
            pg.fill('#sfx-peak', '-6')
            pg.click('#save-runtime')
            expect(pg.locator('.toast.ok', has_text='Runtime settings saved')).to_be_visible()
            pg.fill('#sfx-peak', '5')
            pg.click('#save-runtime')
            expect(pg.locator('.toast.error')).to_contain_text('-12 and -1')
            assert 'one after another' in pg.inner_text('#view')
            pg.reload()
            expect(pg.locator('#beat-concurrency')).to_have_value('2')
            expect(pg.locator('#cap-run_usd')).to_have_value('12.5')
            expect(pg.locator('#pick-director button[aria-selected=true]')).to_have_attribute('data-id', 'aurora-8b')
            pg.click('#kill-switch')
            expect(pg.locator('dialog[open]')).to_be_visible()
            confirm(s)
            expect(pg.locator('#banners .banner.kill')).to_be_visible()
            expect(pg.locator('#kill-switch')).to_have_attribute('aria-checked', 'true')
            s.shot('settings-kill')
            s.go('#/projects')
            expect(pg.locator('#banners .banner.kill')).to_be_visible()
            s.go('#/settings')
            pg.click('#kill-switch')
            confirm(s)
            expect(pg.locator('#banners .banner.kill')).to_have_count(0)
            log(name, 'settings + kill switch ok')

            # 10. dark mode follows prefers-color-scheme
            light = pg.evaluate("getComputedStyle(document.body).backgroundColor")
            assert light == 'rgb(243, 234, 215)', 'light background is PAPER, got ' + light
            dark = Session(browser, base, name + '-dark', VIEWPORTS[name], 'dark')
            dark.page.goto(base + '#/login')
            dark.page.fill('#pw', 'demo')
            dark.page.click('button[type=submit]')
            expect(dark.page.locator('.pcard').first).to_be_visible()
            bg = dark.page.evaluate("getComputedStyle(document.body).backgroundColor")
            assert bg == 'rgb(34, 30, 26)', 'dark background is INK, got ' + bg
            dark.shot('projects-dark', full=False)
            dark.ctx.close()

            # 11. logout, then a 401 mid-session sends the UI to login
            s.go('#/settings')
            expect(pg.locator('#logout')).to_be_visible()
            pg.click('#logout')
            expect(pg.locator('#pw')).to_be_visible()
            pg.fill('#pw', 'demo')
            pg.click('button[type=submit]')
            expect(pg.locator('.pcard').first).to_be_visible()
            s.go('#/p/p_build/beats')
            expect(pg.locator('.bcard')).to_have_count(12)
            with s.tolerate():
                urllib.request.urlopen(urllib.request.Request(base + '__test/expire', method='POST')).read()
                expect(pg.locator('#pw')).to_be_visible(timeout=15000)
            assert pg.evaluate('location.hash') == '#/login'
            log(name, '401 redirect to login ok')

            assert not s.errors, 'console errors at %s: %s' % (name, s.errors[:5])
            browser.close()
        log(name, 'ALL PASSED')
        return True
    finally:
        proc.terminate()


# ------------------------------------------------------------------ cold start (own server)
def run_cold(headed=False):
    from playwright.sync_api import sync_playwright, expect
    expect.set_options(timeout=25000)
    # 1) the CLI flag: every request, including static files, answers 503 for N seconds
    proc, port = start_server('--cold-start', '4', '--speed', '3')
    try:
        t0 = time.time()
        codes = []
        while time.time() - t0 < 8:
            try:
                codes.append(urllib.request.urlopen('http://127.0.0.1:%d/api/me' % port).status)
            except urllib.error.HTTPError as e:
                codes.append(e.code)
            if codes[-1] != 503:
                break
            time.sleep(0.5)
        assert codes[0] == 503 and codes[-1] == 401, '--cold-start answers 503 and then works: %s' % codes
    finally:
        proc.terminate()
    # 2) the banner: load the app, then put the server to sleep for 7 s (first retry at 5 s still fails, second at 10 s works)
    proc, port = start_server('--speed', '3')
    base = 'http://127.0.0.1:%d/' % port
    try:
        with sync_playwright() as p:
            browser = launch(p, headed)
            s = Session(browser, base, 'cold', VIEWPORTS['mobile'])
            pg = s.page
            with s.tolerate():
                s.go('#/login')
                pg.fill('#pw', 'demo')
                pg.click('button[type=submit]')
                expect(pg.locator('.pcard').first).to_be_visible()
                s.go('#/p/p_build/beats')
                expect(pg.locator('.bcard')).to_have_count(12)
                urllib.request.urlopen(urllib.request.Request(base + '__test/cold?s=7', method='POST')).read()
                t0 = time.time()
                s.go('#/projects')  # projects page is already loaded: only its API call hits the sleeping server
                expect(pg.locator('#banners .banner.wake')).to_contain_text('Waking the server (about a minute)...', timeout=8000)
                s.shot('cold-banner', full=False)
                expect(pg.locator('#banners .banner.wake')).to_have_count(0, timeout=30000)
                took = time.time() - t0
                assert 9 <= took <= 16, 'retries are 5 s apart, so recovery takes ~10 s, took %.1f' % took
                expect(pg.locator('.pcard').first).to_be_visible()
                # a POST is never retried: it fails once and shows an error
                urllib.request.urlopen(urllib.request.Request(base + '__test/cold?s=3', method='POST')).read()
                pg.click('#new-project')
                pg.fill('#np-name', 'Never retried')
                pg.click('form.newform button[type=submit]')
                expect(pg.locator('.toast.error')).to_be_visible()
                assert pg.locator('#banners .banner.wake').count() == 0, 'no waking banner for POST'
            browser.close()
        log('cold', 'ALL PASSED')
    finally:
        proc.terminate()


# ------------------------------------------------------------------ static scan
FORBIDDEN = [r'innerHTML', r'outerHTML', r'insertAdjacentHTML', r'document\.write', r'\beval\s*\(', r'new\s+Function', r'https?://', r'//cdn\.', r'\bimport\s*\(\s*[\'"]https?']


def run_static():
    bad = []
    files = sorted((ROOT / 'web').rglob('*.js')) + sorted((ROOT / 'web').rglob('*.html')) + sorted((ROOT / 'web').rglob('*.css'))
    assert files
    for f in files:
        text = f.read_text()
        for pat in FORBIDDEN:
            for m in re.finditer(pat, text):
                line = text.count('\n', 0, m.start()) + 1
                bad.append('%s:%d forbidden %r' % (f.relative_to(ROOT), line, pat))
    # budgets (excluding mock and tests)
    js = sum(len(f.read_text().splitlines()) for f in (ROOT / 'web').rglob('*.js'))
    css = sum(len(f.read_text().splitlines()) for f in (ROOT / 'web').rglob('*.css'))
    log('static', 'JS lines %d (budget 3000 is informational), CSS lines %d (budget 700)' % (js, css))
    assert not bad, 'static scan failed:\n  ' + '\n  '.join(bad)
    # no frameworks or external fonts referenced from the HTML
    html = (ROOT / 'web' / 'index.html').read_text()
    assert 'fonts.googleapis' not in html and '<script src="http' not in html
    log('static', 'ALL PASSED (no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function/external URLs)')


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=['static', 'mobile', 'desktop', 'cold'])
    ap.add_argument('--headed', action='store_true')
    a = ap.parse_args()
    if a.only == 'static':
        run_static()
        return 0
    if a.only in VIEWPORTS:
        run_viewport(a.only, a.headed)
        return 0
    if a.only == 'cold':
        run_cold(a.headed)
        return 0
    run_static()
    results = {}

    ts = [threading.Thread(target=lambda n=n: worker_proc(n, results, a)) for n in ('mobile', 'desktop', 'cold')]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    failed = {k: v for k, v in results.items() if v}
    print('\n=== RESULTS ===')
    for k in ('mobile', 'desktop', 'cold'):
        print('%-8s %s' % (k, 'PASS' if not results.get(k) else 'FAIL'))
    for k, v in failed.items():
        print('\n--- %s ---\n%s' % (k, v))
    return 1 if failed else 0


def worker_proc(name, results, a):
    """each pass runs in its own Python process (sync Playwright is not thread friendly)"""
    cmd = [sys.executable, str(Path(__file__).resolve()), '--only', name] + (['--headed'] if a.headed else [])
    pr = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(pr.stdout)
    results[name] = None if pr.returncode == 0 else (pr.stderr[-3500:] or pr.stdout[-3500:])


if __name__ == '__main__':
    try:
        rc = main()
    except AssertionError:
        import traceback
        traceback.print_exc()
        rc = 1
    sys.exit(rc or 0)
