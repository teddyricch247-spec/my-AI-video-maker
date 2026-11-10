import { api } from '../api.js';
import { watchProject } from '../poller.js';
import { createChat } from '../chat.js';
import { createPreview } from '../preview.js';
import { el, act, toast, statusChip, modeChip, confirmDialog, lightbox, setText, money } from '../ui.js';
import { rich, fmtDate, fmtDuration, plural } from '../format.js';

const REVIEWABLE = new Set(['waiting_user', 'needs_attention']);
const RETRYABLE = new Set(['needs_attention', 'failed', 'skipped']);
const SKIPPABLE = new Set(['queued', 'waiting_user', 'needs_attention', 'failed']);

function checkLines(text) {
  return String(text || '').split('\n').filter((l) => l.trim()).map((l) => {
    const m = /^\S+\s+(error|warn)\b/.exec(l);
    return el('span', { class: 'l ' + (m ? m[1] : ''), text: l });
  });
}

function checkBadge(c) {
  if (!c) return el('span', { class: 'chip', text: 'no checks' });
  if (c.counts.error) return el('span', { class: 'chip chip-bad', text: plural(c.counts.error, 'error') });
  if (c.counts.warn) return el('span', { class: 'chip chip-warn', text: plural(c.counts.warn, 'warning') });
  return el('span', { class: 'chip chip-ok', text: 'checks ok' });
}

export async function mount(view, params, app) {
  const bid = params.bid;
  let d = null; // BeatDetail
  let dead = false;
  let preview = null;
  let loadedKey = '';
  let versionsSig = '';
  let chat = null;
  let beats = [];
  let watcher = null;
  let project = null;
  let loadingDetail = false;
  let sfxAudio = null;
  let sfxPlaying = null;

  // ---- skeleton
  const navTop = el('div', { class: 'navrow', id: 'beat-nav' });
  const previewBox = el('div', { class: 'a-preview', id: 'preview-box' });
  const title = el('h2', { id: 'beat-title' });
  const chips = el('div', { class: 'beat-meta' });
  const direction = el('p', { class: 'muted', id: 'beat-direction' });
  const textQuote = el('blockquote', { class: 'beat-text', id: 'beat-text' });
  const summary = el('div', { id: 'beat-summary' });
  const reason = el('div', { class: 'note note-err', hidden: true, id: 'beat-reason' });
  const meta = el('section', { class: 'a-meta stack' }, title, chips, reason, direction, textQuote, summary);

  const approveBtn = el('button', { class: 'btn btn-ok', type: 'button', id: 'approve-beat', text: 'Approve', onclick: async () => {
    const r = await act(approveBtn, () => api.post('/beats/' + bid + '/approve'), 'Beat approved');
    if (r.ok) apply(r.value);
  } });
  const retryBtn = el('button', { class: 'btn', type: 'button', id: 'retry-beat', text: 'Retry', onclick: async () => {
    const r = await act(retryBtn, () => api.post('/beats/' + bid + '/retry'), 'Retry queued');
    if (r.ok) apply(r.value);
  } });
  const skipBtn = el('button', { class: 'btn btn-danger', type: 'button', id: 'skip-beat', text: 'Skip', onclick: async () => {
    if (!(await confirmDialog({ title: 'Skip this beat?', message: 'It will be left out of the export.', ok: 'Skip beat', danger: true }))) return;
    const r = await act(skipBtn, () => api.post('/beats/' + bid + '/skip'), 'Beat skipped');
    if (r.ok) apply(r.value);
  } });
  const actions = el('section', { class: 'card actions-card a-actions', 'aria-label': 'Review actions' }, approveBtn, retryBtn, skipBtn);

  const checksBox = el('section', { class: 'a-checks', id: 'checks-box', 'aria-labelledby': 'h-checks' });
  const versionsBox = el('section', { class: 'a-versions', id: 'versions-box' });
  const chatBox = el('section', { class: 'a-chat', 'aria-labelledby': 'h-chat' }, el('h2', { id: 'h-chat', text: 'Chat with this beat’s agent' }));
  view.append(navTop, el('div', { class: 'beat-layout' },
    el('div', { class: 'col-main' }, previewBox, meta, checksBox, versionsBox),
    el('div', { class: 'col-side' }, actions, chatBox)));

  // ---- navigation (prev / next / next to review)
  function renderNav() {
    const idx = d ? d.idx : 0;
    const prev = beats.find((b) => b.idx === idx - 1);
    const next = beats.find((b) => b.idx === idx + 1);
    const later = beats.filter((b) => b.idx > idx && REVIEWABLE.has(b.status));
    const earlier = beats.filter((b) => b.idx < idx && REVIEWABLE.has(b.status));
    const review = later[0] || earlier[0];
    const mk = (label, target, id) => target
      ? el('a', { class: 'btn btn-sm', id, href: '#/b/' + target.id, text: label })
      : el('button', { class: 'btn btn-sm', id, type: 'button', disabled: true, text: label });
    navTop.replaceChildren(mk('← Prev', prev, 'nav-prev'), mk('Next →', next, 'nav-next'),
      review ? el('a', { class: 'btn btn-sm btn-primary', id: 'nav-review', href: '#/b/' + review.id, text: 'Next to review' })
        : el('button', { class: 'btn btn-sm', id: 'nav-review', type: 'button', disabled: true, title: 'Nothing is waiting for review', text: 'Next to review' }),
      el('span', { class: 'spacer' }), d ? el('span', { class: 'muted small', text: 'Beat ' + d.idx + (beats.length ? ' of ' + beats.length : '') }) : null);
  }

  // ---- render pieces
  function renderMeta() {
    setText(title, '#' + d.idx + ' ' + d.title);
    chips.replaceChildren(statusChip(d.status), modeChip(d.mode), el('span', { class: 'chip', text: d.start_tc + ' · ' + fmtDuration(d.duration_s) }),
      el('span', { class: 'chip', text: d.steps + ' steps · ' + money(d.cost_usd) }));
    setText(direction, d.direction);
    setText(textQuote, d.text);
    summary.replaceChildren(...(d.summary ? [el('h3', { text: 'Agent summary' }), rich(d.summary)] : []));
    setText(reason, d.status_reason || '');
    reason.hidden = !d.status_reason;
    approveBtn.disabled = !REVIEWABLE.has(d.status);
    setText(approveBtn, d.status === 'approved' ? 'Approved' : 'Approve');
    retryBtn.hidden = !RETRYABLE.has(d.status);
    skipBtn.hidden = !SKIPPABLE.has(d.status);
  }

  function renderChecks() {
    const cur = d.scene_versions.find((v) => v.is_current);
    checksBox.replaceChildren(el('h2', { id: 'h-checks', text: 'Checks' }));
    if (!cur) {
      checksBox.append(el('p', { class: 'muted', text: 'No scene yet, so there are no checks.' }));
      return;
    }
    const c = cur.checks;
    checksBox.append(el('div', { class: 'row' }, el('span', { class: 'muted', text: 'Scene v' + cur.n }),
      el('span', { class: 'chip ' + (c.counts.error ? 'chip-bad' : 'chip-ok'), text: plural(c.counts.error, 'error') }),
      el('span', { class: 'chip ' + (c.counts.warn ? 'chip-warn' : ''), text: plural(c.counts.warn, 'warning') })),
    el('pre', { class: 'checks', id: 'checks-text' }, checkLines(c.text)));
  }

  function stopSfx() {
    if (sfxAudio) { sfxAudio.pause(); sfxAudio.removeAttribute('src'); sfxAudio.load(); sfxAudio = null; }
    if (sfxPlaying) { sfxPlaying.textContent = '▶ Play'; sfxPlaying = null; }
  }
  function playSfx(btn, url) {
    const same = sfxPlaying === btn;
    stopSfx();
    if (same) return;
    sfxAudio = new Audio(url);
    sfxPlaying = btn;
    btn.textContent = '❚❚ Stop';
    sfxAudio.addEventListener('ended', stopSfx);
    sfxAudio.addEventListener('error', () => { stopSfx(); toast('Could not play this sound', 'error'); });
    if (preview) preview.pause();
    sfxAudio.play().catch(() => { stopSfx(); toast('The browser blocked sound; tap play again.', 'error'); });
  }

  async function revert(btn, body, label) {
    const r = await act(btn, () => api.post('/beats/' + bid + '/revert', body), label);
    if (r.ok) apply(r.value);
  }

  function renderVersions() {
    const sig = JSON.stringify([d.scene_versions.map((v) => [v.n, v.is_current, v.strip_url, v.checks.counts]), d.sfx_versions.map((v) => [v.n, v.is_current]), d.status === 'running']);
    if (sig === versionsSig) return;
    versionsSig = sig;
    stopSfx();
    const busy = d.status === 'running';
    const scenes = d.scene_versions.map((v) => {
      const use = el('button', { class: 'btn btn-sm', type: 'button', text: 'Use this version', disabled: v.is_current || busy, 'data-n': v.n, onclick: () => revert(use, { scene_n: v.n }, 'Switched to scene v' + v.n) });
      return el('article', { class: 'card ver', dataset: { kind: 'scene', n: v.n, current: String(v.is_current) } },
        el('img', { src: v.strip_url, alt: 'Contact sheet of scene v' + v.n, loading: 'lazy', onclick: () => lightbox(v.strip_url, 'Scene v' + v.n) }),
        el('div', { class: 'info' }, el('div', { class: 'row' }, el('strong', { text: 'v' + v.n }), v.is_current ? el('span', { class: 'chip chip-ok', text: 'Current' }) : null, checkBadge(v.checks), el('span', { class: 'chip', text: v.created_by })),
          el('div', { class: 'small muted', text: fmtDate(v.created_at) }), el('div', { class: 'acts' }, use)));
    });
    const sounds = d.sfx_versions.map((v) => {
      const play = el('button', { class: 'btn btn-sm', type: 'button', text: '▶ Play', 'aria-label': 'Play sound v' + v.n, onclick: () => playSfx(play, v.wav_url) });
      const use = el('button', { class: 'btn btn-sm', type: 'button', text: 'Use this version', disabled: v.is_current || busy, 'data-n': v.n, onclick: () => revert(use, { sfx_n: v.n }, 'Switched to sound v' + v.n) });
      return el('article', { class: 'card ver', dataset: { kind: 'sfx', n: v.n, current: String(v.is_current) } },
        el('img', { src: v.spectrogram_url, alt: 'Spectrogram of sound v' + v.n, loading: 'lazy', onclick: () => lightbox(v.spectrogram_url, 'Spectrogram v' + v.n) }),
        el('div', { class: 'info' }, el('div', { class: 'row' }, el('strong', { text: 'v' + v.n }), v.is_current ? el('span', { class: 'chip chip-ok', text: 'Current' }) : null, checkBadge(v.checks)),
          el('div', { class: 'small muted', text: fmtDate(v.created_at) }),
          v.checks ? el('pre', { class: 'checks' }, checkLines(v.checks.text)) : null, el('div', { class: 'acts' }, play, use)));
    });
    versionsBox.replaceChildren(
      el('h2', { text: 'Scene versions' }), el('div', { class: 'vlist', id: 'scene-versions' }, scenes.length ? scenes : el('p', { class: 'muted', text: 'No scene versions yet.' })),
      el('h2', { class: 'sect', text: 'Sound effect versions' }), el('div', { class: 'vlist', id: 'sfx-versions' }, sounds.length ? sounds : el('p', { class: 'muted', text: project && !project.sfx_enabled ? 'Sound effects are off for this project.' : 'No sound versions yet.' })));
  }

  async function loadPreview() {
    const key = d.scene_n + '|' + d.sfx_n;
    if (key === loadedKey) return;
    if (d.scene_n == null) {
      previewBox.replaceChildren(el('div', { class: 'note', id: 'no-scene', text: d.status === 'running' ? 'The agent is building the first scene...' : 'No scene yet, so there is nothing to preview.' }));
      loadedKey = key;
      return;
    }
    loadedKey = key;
    try {
      const bundle = await api.get('/beats/' + bid + '/preview');
      if (dead) return;
      if (!preview) {
        previewBox.replaceChildren();
        preview = createPreview({ beat: d, words: d.words });
        previewBox.append(preview.el);
      }
      preview.setBundle(bundle);
    } catch (e) {
      loadedKey = '';
      if (!dead && e.status !== 401) previewBox.replaceChildren(el('div', { class: 'note note-err', text: 'Could not load the preview: ' + e.message }));
    }
  }

  function ensureChat() {
    if (chat || !d.session_id) return;
    const quick = project && project.sfx_enabled === false ? [] : [{ label: 'Redo the sound', text: 'Redo the sound effects for this beat.' }];
    // When the agent starts or stops working on feedback, refresh the beat right away instead of waiting for the next status poll.
    let wasBusy = null;
    chat = createChat({ sessionId: d.session_id, quick, onSession: (sess) => {
      const busy = sess.status === 'queued' || sess.status === 'running';
      if (wasBusy !== null && busy !== wasBusy && !dead) loadDetail().catch(() => {});
      wasBusy = busy;
    } });
    chatBox.append(chat.el);
  }

  function apply(detail) {
    if (dead) return;
    d = detail;
    renderMeta();
    renderChecks();
    renderVersions();
    renderNav();
    ensureChat();
    loadPreview();
    if (watcher) watcher.now();
  }

  async function loadDetail() {
    if (loadingDetail) return;
    loadingDetail = true;
    try {
      const nd = await api.get('/beats/' + bid);
      if (!dead) apply(nd);
      return nd;
    } finally { loadingDetail = false; }
  }

  const first = await loadDetail().catch((e) => {
    if (e.status !== 401) view.replaceChildren(el('div', { class: 'note note-err', text: e.status === 404 ? 'This beat does not exist.' : e.message }), el('a', { class: 'btn', href: '#/projects', text: 'Back to projects' }));
    return null;
  });
  if (!first || dead) return () => { dead = true; };

  app.setTop({ pid: d.project_id, back: '#/p/' + d.project_id + '/beats' });
  watcher = watchProject(d.project_id, ({ project: p, beats: bs }) => {
    if (dead) return;
    project = p;
    beats = bs;
    app.setTop({ title: p.name, pid: d.project_id });
    renderNav();
    const mine = bs.find((b) => b.id === bid);
    if (mine && mine.updated_at !== d.updated_at) loadDetail();
  });

  return () => {
    dead = true;
    if (watcher) watcher.stop();
    if (chat) chat.destroy();
    if (preview) preview.destroy(); // pauses and releases the audio element
    stopSfx();
  };
}
