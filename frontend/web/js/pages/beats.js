import { api } from '../api.js';
import { watchProject } from '../poller.js';
import { el, act, statusChip, setChip, setText, setProgress, progressBar, confirmDialog, emptyState, money, statusLabel } from '../ui.js';
import { fmtDuration } from '../format.js';

const STATUSES = ['queued', 'running', 'waiting_user', 'needs_attention', 'approved', 'failed', 'skipped'];
const RETRYABLE = new Set(['needs_attention', 'failed']);
const SKIPPABLE = new Set(['queued', 'waiting_user', 'needs_attention', 'failed']);

export async function mount(view, params, app) {
  const pid = params.pid;
  let filter = 'all';
  let project = null;
  let dead = false;
  const cards = new Map(); // beat id -> {node, refs, beat}

  // ---- header
  const bar = progressBar(0, 0, 'Beats approved');
  const approvedTxt = el('strong', { id: 'approved-txt' });
  const modeTxt = el('span', { id: 'run-mode' });
  const costTxt = el('span', { id: 'cost-total' });
  const pausedChip = el('span', { class: 'chip chip-warn', text: 'Paused', hidden: true, id: 'paused-chip' });
  const pauseBtn = el('button', { class: 'btn', type: 'button', id: 'pause-btn', onclick: async () => {
    const path = project.paused ? '/run/resume' : '/run/pause';
    const r = await act(pauseBtn, () => api.post('/projects/' + pid + path), project.paused ? 'Resumed' : 'Pausing after the current beat');
    if (r.ok) { project = r.value; renderHead(); watcher.now(); }
  } });
  const pauseHelp = el('div', { class: 'hint', text: 'Pause finishes the current beat, then stops. Resume starts the next queued beat.' });
  const head = el('section', { class: 'card beats-head', 'aria-label': 'Progress' },
    el('div', { class: 'row' }, approvedTxt, el('span', { class: 'muted', text: 'beats approved' }), el('span', { class: 'spacer' }), pausedChip),
    bar,
    el('div', { class: 'row small muted' }, modeTxt, costTxt),
    el('div', { class: 'row' }, pauseBtn), pauseHelp);
  const filters = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by status' });
  const grid = el('div', { class: 'grid', id: 'beat-grid' });
  const empty = el('div', { hidden: true }, emptyState('No beats yet', 'Approve a plan to create beats.'));
  const toPlan = el('a', { class: 'btn', href: '#/p/' + pid + '/plan', text: 'Go to plan', hidden: true });
  view.append(el('div', { class: 'page-head' }, el('h2', { text: 'Beats' }), el('span', { class: 'spacer' }), el('a', { class: 'btn btn-sm', href: '#/p/' + pid + '/export', text: 'Export' })), head, filters, grid, empty, toPlan);

  function renderHead() {
    const p = project;
    const total = Object.values(p.beat_counts).reduce((a, b) => a + b, 0);
    setText(approvedTxt, p.beat_counts.approved + ' / ' + total);
    setProgress(bar, p.beat_counts.approved, total);
    setText(modeTxt, 'Mode: ' + (p.run_mode === 'pilot' ? 'Pilot (pause after beat 1)' : 'Run all'));
    setText(costTxt, 'Cost so far: ' + money(p.cost_usd));
    pausedChip.hidden = !p.paused;
    const building = p.plan_approved && p.status !== 'done';
    pauseBtn.hidden = pauseHelp.hidden = !p.plan_approved;
    setText(pauseBtn, p.paused ? 'Resume' : 'Pause');
    pauseBtn.disabled = !building;
    app.setTop({ title: p.name, pid });
  }

  function renderFilters(beats) {
    const counts = { all: beats.length };
    for (const b of beats) counts[b.status] = (counts[b.status] || 0) + 1;
    const want = ['all', ...STATUSES.filter((s) => counts[s])];
    if (!want.includes(filter)) filter = 'all';
    const sig = want.map((s) => s + counts[s]).join();
    if (filters.dataset.sig === sig + filter) return;
    filters.dataset.sig = sig + filter;
    filters.replaceChildren(...want.map((s) => el('button', { class: 'btn', type: 'button', 'aria-pressed': String(filter === s), 'data-filter': s,
      text: (s === 'all' ? 'All' : statusLabel(s)) + ' ' + counts[s], onclick: () => { filter = s; applyFilter(); renderFilters(lastBeats); } })));
  }

  function build(b) {
    const strip = el('img', { class: 'strip', alt: '', loading: 'lazy' });
    const stripEmpty = el('div', { class: 'strip empty', text: 'No scene yet' });
    const idx = el('span', { class: 'idx' });
    const title = el('h3');
    const chip = statusChip(b.status);
    const pulse = el('span', { class: 'pulse', text: 'now running', hidden: true });
    const timing = el('div', { class: 'small muted' });
    const stats = el('div', { class: 'small muted' });
    const reason = el('div', { class: 'reason', hidden: true });
    const open = el('a', { class: 'btn btn-sm', text: 'Open', href: '#/b/' + b.id, 'aria-label': 'Open beat' });
    const retry = el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Retry', onclick: async () => {
      const r = await act(retry, () => api.post('/beats/' + b.id + '/retry'), 'Retry queued');
      if (r.ok) watcher.now();
    } });
    const skip = el('button', { class: 'btn btn-sm', type: 'button', text: 'Skip', onclick: async () => {
      const cur = cards.get(b.id).beat;
      if (!(await confirmDialog({ title: 'Skip this beat?', message: 'Beat ' + cur.idx + ' "' + cur.title + '" will be left out of the export.', ok: 'Skip beat', danger: true }))) return;
      const r = await act(skip, () => api.post('/beats/' + b.id + '/skip'), 'Beat skipped');
      if (r.ok) watcher.now();
    } });
    const node = el('article', { class: 'card bcard', dataset: { bid: b.id } }, stripEmpty, strip,
      el('div', { class: 'body' }, el('div', { class: 'head' }, idx, title), el('div', { class: 'row' }, chip, pulse), timing, stats, reason, el('div', { class: 'actions' }, open, retry, skip)));
    return { node, refs: { strip, stripEmpty, idx, title, chip, pulse, timing, stats, reason, retry, skip }, beat: b };
  }

  function patch(c, b) {
    const r = c.refs;
    c.beat = b;
    setText(r.idx, '#' + b.idx);
    setText(r.title, b.title);
    setChip(r.chip, b.status);
    setText(r.timing, b.start_tc + ' · ' + fmtDuration(b.duration_s));
    setText(r.stats, b.steps + ' steps · ' + money(b.cost_usd));
    setText(r.reason, b.status_reason || '');
    r.reason.hidden = !b.status_reason;
    r.pulse.hidden = !(project && project.running_beat_id === b.id);
    c.node.dataset.running = String(!r.pulse.hidden);
    c.node.dataset.status = b.status;
    if (b.strip_url) {
      if (r.strip.getAttribute('src') !== b.strip_url) r.strip.setAttribute('src', b.strip_url);
      r.strip.hidden = false;
      r.stripEmpty.hidden = true;
    } else {
      r.strip.hidden = true;
      r.stripEmpty.hidden = false;
    }
    r.retry.hidden = !RETRYABLE.has(b.status);
    r.skip.hidden = !SKIPPABLE.has(b.status);
  }

  function applyFilter() {
    for (const c of cards.values()) c.node.hidden = filter !== 'all' && c.beat.status !== filter;
  }

  let lastBeats = [];
  function update({ project: p, beats }) {
    if (dead) return;
    project = p;
    lastBeats = beats;
    renderHead();
    const seen = new Set();
    beats.forEach((b, i) => {
      let c = cards.get(b.id);
      if (!c) { c = build(b); cards.set(b.id, c); }
      patch(c, b);
      seen.add(b.id);
      if (grid.children[i] !== c.node) grid.insertBefore(c.node, grid.children[i] || null);
    });
    for (const [id, c] of cards) if (!seen.has(id)) { c.node.remove(); cards.delete(id); }
    renderFilters(beats);
    applyFilter();
    empty.hidden = beats.length > 0;
    toPlan.hidden = beats.length > 0;
    head.hidden = beats.length === 0;
  }

  const watcher = watchProject(pid, update);
  return () => { dead = true; watcher.stop(); };
}
