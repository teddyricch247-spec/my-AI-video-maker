import { api } from '../api.js';
import { watchProject } from '../poller.js';
import { createChat } from '../chat.js';
import { el, act, confirmDialog, modeChip, setText } from '../ui.js';
import { rich, fmtDuration } from '../format.js';

export async function mount(view, params, app) {
  const pid = params.pid;
  let project = null;
  let dead = false;
  let chat = null;
  let chatSid = null;
  let lastRev = -1;
  let planLoading = false;
  let tab = 'chat';
  let runMode = 'run_all';

  const start = el('div', { id: 'plan-start', hidden: true });
  const main = el('div', { id: 'plan-main', hidden: true });
  view.append(el('div', { class: 'page-head' }, el('h2', { text: 'Plan' })), start, main);

  // ---- start block
  const instr = el('textarea', { id: 'plan-instructions', rows: 5, placeholder: 'Optional: tell the Director what you want (tone, length of beats, things to avoid)', 'aria-label': 'Instructions for the Director' });
  const startBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'plan-start-btn', text: 'Start planning', onclick: async () => {
    const r = await act(startBtn, () => api.post('/projects/' + pid + '/plan/start', instr.value.trim() ? { instructions: instr.value.trim() } : {}));
    if (r.ok) watcher.now();
  } });
  const startHint = el('div', { class: 'hint' });
  start.append(el('section', { class: 'card stack' }, el('h3', { text: 'Ask the Director for a plan' }),
    el('p', { class: 'muted', text: 'The Director reads your transcript and proposes beats and a story bible. You can chat to change it before approving.' }),
    el('div', null, el('label', { for: 'plan-instructions', text: 'Instructions' }), instr), el('div', { class: 'row' }, startBtn, startHint)));

  // ---- two panes
  const seg = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Plan view' },
    ['chat', 'plan'].map((t) => el('button', { type: 'button', role: 'tab', 'data-tab': t, 'aria-selected': String(t === tab), text: t === 'chat' ? 'Chat' : 'Plan', onclick: () => setTab(t) })));
  const chatPane = el('div', { class: 'pane pane-chat' });
  const planPane = el('div', { class: 'pane pane-plan' });
  const grid = el('div', { class: 'plan-grid', 'data-tab': tab }, chatPane, planPane);
  main.append(seg, grid);
  function setTab(t) {
    tab = t;
    grid.dataset.tab = t;
    for (const b of seg.children) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  }

  const validationBox = el('div', { id: 'validation' });
  const bibleBody = el('div');
  const bibleBox = el('details', { class: 'card bible', hidden: true }, el('summary', { text: 'Story bible' }), bibleBody);
  const beatsBox = el('div', { class: 'stack', id: 'plan-beats' });
  const approveBox = el('section', { class: 'card approve stack', id: 'approve-box' });
  const sumLine = el('div', { class: 'muted small', id: 'plan-sum' });
  planPane.append(approveBox, validationBox, sumLine, beatsBox, bibleBox);

  const approveBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'approve-btn', text: 'Approve plan', onclick: async () => {
    const ok = await confirmDialog({ title: 'Approve this plan?', message: 'Beat agents will start building right away' + (runMode === 'pilot' ? ' and pause after beat 1' : '') + '. The plan can no longer be changed.', ok: 'Approve and build' });
    if (!ok) return;
    const r = await act(approveBtn, () => api.post('/projects/' + pid + '/plan/approve', { run_mode: runMode }), 'Plan approved');
    if (r.ok) { watcher.now(); loadPlan(true); }
  } });
  const radios = [['run_all', 'Run all'], ['pilot', 'Pause after beat 1 (pilot)']].map(([v, l]) =>
    el('label', { class: 'radio' }, el('input', { type: 'radio', name: 'run_mode', value: v, checked: v === runMode, onchange: () => { runMode = v; } }), l));
  const approveMsg = el('div', { class: 'hint', id: 'approve-hint' });
  const approvedBox = el('div', { hidden: true }, el('p', null, el('strong', { text: 'Plan approved.' }), ' This page is now read-only.'), el('a', { class: 'btn btn-primary', href: '#/p/' + pid + '/beats', text: 'Go to Beats' }));
  const approveForm = el('div', { class: 'stack' }, el('h3', { text: 'Approve' }), el('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'Run mode' }, radios), approveBtn, approveMsg);
  approveBox.append(approveForm, approvedBox);

  function ensureChat(sid, approved) {
    if (!chat || chatSid !== sid) {
      if (chat) chat.destroy();
      chatSid = sid;
      chat = createChat({ sessionId: sid, quick: [], readOnly: approved, readOnlyNote: 'The plan is approved; the Director chat is closed.' });
      chatPane.replaceChildren(chat.el);
    }
    chat.setReadOnly(approved, 'The plan is approved; the Director chat is closed.');
  }

  let lastSig = '';
  function renderPlan(pl) {
    // Build progress changes beat statuses constantly; only the plan's own fields decide whether to redraw.
    const sig = JSON.stringify([pl.beats.map((b) => [b.idx, b.title, b.mode, b.direction, b.text, b.start_tc, b.duration_s]), pl.bible, pl.validation, pl.ready, pl.approved]);
    if (sig === lastSig) return;
    lastSig = sig;
    const approved = pl.approved;
    const issues = pl.validation || [];
    approveForm.hidden = approved;
    approvedBox.hidden = !approved;
    const can = pl.ready && !issues.length && !approved;
    approveBtn.disabled = !can;
    setText(approveMsg, can ? '' : !pl.ready ? 'The Director has not marked the plan ready yet.' : 'Fix the validation messages first.');
    for (const r of radios) r.querySelector('input').disabled = approved;
    validationBox.replaceChildren(...(issues.length ? [el('h3', { text: 'Validation' }), el('ul', { class: 'validation note note-warn' }, issues.map((v) => el('li', { text: v })))] : []));
    setText(sumLine, pl.beats.length + ' beats' + (pl.beats.length ? ' · ' + fmtDuration(pl.beats.reduce((a, b) => a + b.duration_s, 0)) + ' total' : ''));
    beatsBox.replaceChildren(...pl.beats.map((b) => el('article', { class: 'card plan-item', dataset: { idx: b.idx } },
      el('div', { class: 'top' }, el('span', { class: 'idx', text: '#' + b.idx }), el('span', { text: b.start_tc }), el('span', { text: fmtDuration(b.duration_s) }), modeChip(b.mode)),
      el('h3', { text: b.title }), el('div', { class: 'dir', text: b.direction }),
      el('div', { class: 'txt', text: b.text.length > 140 ? b.text.slice(0, 140) + '…' : b.text }))));
    if (!pl.beats.length) beatsBox.replaceChildren(el('p', { class: 'muted', text: 'No beats yet. The Director is still working.' }));
    bibleBox.hidden = !pl.bible;
    if (pl.bible && bibleBody.dataset.src !== pl.bible) {
      bibleBody.dataset.src = pl.bible;
      bibleBody.replaceChildren(rich(pl.bible));
    }
  }

  async function loadPlan(force) {
    if (planLoading) return;
    planLoading = true;
    try {
      const pl = await api.get('/projects/' + pid + '/plan');
      if (dead) return;
      if (pl.session) ensureChat(pl.session.id, pl.approved);
      renderPlan(pl);
    } finally { planLoading = false; }
  }

  const watcher = watchProject(pid, ({ rev, project: p }) => {
    if (dead) return;
    project = p;
    app.setTop({ title: p.name, pid });
    const hasSession = !!p.director_session_id;
    start.hidden = hasSession;
    main.hidden = !hasSession;
    if (!hasSession) {
      startBtn.disabled = !p.word_count;
      setText(startHint, p.word_count ? '' : 'Upload a transcript in Setup first.');
      return;
    }
    if (rev !== lastRev) {
      lastRev = rev;
      loadPlan();
    }
  });
  return () => { dead = true; watcher.stop(); if (chat) chat.destroy(); };
}
