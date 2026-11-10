import { api } from '../api.js';
import { watchProject, poll } from '../poller.js';
import { el, act, statusChip, setChip, progressBar, setProgress, emptyState } from '../ui.js';
import { fmtBytes, fmtDate } from '../format.js';

const ACTIVE = new Set(['queued', 'running']);

export async function mount(view, params, app) {
  const pid = params.pid;
  let dead = false;
  let beats = [];
  let selected = null; // Set of beat ids; null until the first beats arrive (default: approved)
  let beatSig = '';
  const cards = new Map(); // export id -> {node, refs}
  let exportsList = [];

  const listBox = el('div', { class: 'blist', id: 'export-beats' });
  const all = el('input', { type: 'checkbox', id: 'export-all', onchange: () => {
    const on = all.checked;
    for (const b of beats) if (exportable(b)) on ? selected.add(b.id) : selected.delete(b.id);
    syncChecks();
  } });
  const startBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'export-start', text: 'Start export', onclick: async () => {
    const ids = beats.filter((b) => selected.has(b.id) && exportable(b)).map((b) => b.id);
    const r = await act(startBtn, () => api.post('/projects/' + pid + '/exports', { beat_ids: ids }), 'Export started');
    if (r.ok) { upsertExport(r.value); exportsList.unshift(r.value); poller.now(); }
  } });
  const count = el('span', { class: 'muted small', id: 'export-count' });
  const exportsBox = el('div', { class: 'stack', id: 'exports' });
  const noExports = el('div', { hidden: true }, emptyState('No exports yet', 'Pick beats above and start an export.'));
  view.append(el('div', { class: 'page-head' }, el('h2', { text: 'Export' })),
    el('section', { class: 'card stack' }, el('h3', { text: 'Beats to export' }), el('label', { class: 'check' }, all, 'Select all'), listBox,
      el('div', { class: 'row' }, startBtn, count),
      el('p', { class: 'hint', text: 'You get one MP4 per beat (sound effects baked in) plus a manifest. Export files expire after a while; expired files can be rebuilt by exporting again.' })),
    el('h3', { style: 'margin:18px 0 8px', text: 'Exports' }), exportsBox, noExports);

  const exportable = (b) => b.scene_n != null;

  function syncChecks() {
    for (const row of listBox.querySelectorAll('input[data-bid]')) row.checked = selected.has(row.dataset.bid);
    const ok = beats.filter(exportable);
    const n = ok.filter((b) => selected.has(b.id)).length;
    all.checked = ok.length > 0 && n === ok.length;
    all.indeterminate = n > 0 && n < ok.length;
    startBtn.disabled = n === 0;
    count.textContent = n + ' of ' + beats.length + ' beats selected';
  }

  function renderBeats() {
    const sig = beats.map((b) => [b.id, b.title, b.status, b.scene_n == null]).join('|');
    if (sig === beatSig) return;
    beatSig = sig;
    listBox.replaceChildren(...(beats.length ? beats.map((b) => {
      const cb = el('input', { type: 'checkbox', 'data-bid': b.id, disabled: !exportable(b), checked: selected.has(b.id), onchange: () => { cb.checked ? selected.add(b.id) : selected.delete(b.id); syncChecks(); } });
      return el('label', { class: 'check' }, cb, el('span', { text: '#' + b.idx + ' ' + b.title }), el('span', { class: 'spacer' }), statusChip(b.status));
    }) : [el('p', { class: 'muted', text: 'No beats yet.' })]));
    syncChecks();
  }

  // ---- exports (patched in place by id)
  function buildCard(e) {
    const status = statusChip(e.status);
    const when = el('strong');
    const prog = progressBar(0, 0, 'Export progress');
    const progTxt = el('span', { class: 'small muted' });
    const body = el('div');
    const node = el('article', { class: 'card stack', dataset: { eid: e.id } }, el('div', { class: 'row' }, when, el('span', { class: 'spacer' }), status), prog, progTxt, body);
    return { node, refs: { status, when, prog, progTxt, body }, sig: '' };
  }

  function upsertExport(e) {
    let c = cards.get(e.id);
    if (!c) {
      c = buildCard(e);
      cards.set(e.id, c);
      exportsBox.prepend(c.node);
    }
    const r = c.refs;
    const expired = e.expires_at && new Date(e.expires_at) < new Date();
    setChip(r.status, expired && e.status === 'done' ? 'skipped' : e.status);
    if (expired && e.status === 'done') r.status.textContent = 'Expired';
    r.when.textContent = 'Export · ' + fmtDate(e.created_at);
    setProgress(r.prog, e.progress.done, e.progress.total);
    r.progTxt.textContent = e.progress.done + ' / ' + e.progress.total + ' beats';
    r.prog.hidden = e.status === 'done';
    const sig = JSON.stringify([e.status, expired, e.files.length, e.zip_url, e.manifest_url, e.error, e.expires_at]);
    if (sig === c.sig) return;
    c.sig = sig;
    const parts = [];
    if (e.error) parts.push(el('div', { class: 'note note-err', text: e.error }));
    if (e.status === 'done' && expired) parts.push(el('div', { class: 'note note-warn', text: 'These files have expired. Export again to rebuild them.' }));
    else if (e.status === 'done') {
      parts.push(el('div', { class: 'row' },
        e.zip_url ? el('a', { class: 'btn btn-sm btn-primary', href: e.zip_url, download: '', text: 'Download zip', 'data-kind': 'zip' }) : null,
        e.manifest_url ? el('a', { class: 'btn btn-sm', href: e.manifest_url, download: '', text: 'Manifest', 'data-kind': 'manifest' }) : null),
      e.expires_at ? el('div', { class: 'small muted', text: 'Expires ' + fmtDate(e.expires_at) }) : null,
      el('ul', { class: 'flist' }, e.files.map((f) => el('li', null, el('span', null, '#' + f.beat_idx + ' ', el('a', { href: f.url, download: f.name, text: f.name })), el('span', { class: 'muted small', text: fmtBytes(f.bytes) })))));
    }
    r.body.replaceChildren(...parts);
  }

  function renderExports(list) {
    exportsList = list;
    for (const e of list) upsertExport(e);
    noExports.hidden = list.length > 0 || cards.size > 0;
  }

  const poller = poll(async (isStopped) => {
    const list = await api.get('/projects/' + pid + '/exports', { alive: () => !isStopped() });
    if (!isStopped()) renderExports(list);
  }, () => (exportsList.some((e) => ACTIVE.has(e.status)) ? 2000 : 20000));

  const watcher = watchProject(pid, ({ project, beats: bs }) => {
    if (dead) return;
    app.setTop({ title: project.name, pid });
    beats = bs;
    if (!selected) selected = new Set(bs.filter((b) => b.status === 'approved' && exportable(b)).map((b) => b.id));
    renderBeats();
  });
  return () => { dead = true; watcher.stop(); poller.stop(); };
}
