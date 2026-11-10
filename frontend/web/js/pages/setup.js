import { api } from '../api.js';
import { watchProject } from '../poller.js';
import { el, act, toast, confirmDialog, lightbox } from '../ui.js';
import { fmtMs, fmtBytes } from '../format.js';

const ACCEPT = '.json,.srt,.vtt,.txt';

export async function mount(view, params, app) {
  const pid = params.pid;
  let project = null;
  let lastFormat = null; // only known right after an upload in this tab
  let busy = false;
  let mediaSig = '';
  let dead = false;

  // ---- transcript block
  const fileInput = el('input', { type: 'file', id: 'transcript-file', accept: ACCEPT, class: 'sr-only', onchange: () => { if (fileInput.files[0]) sendTranscript(fileInput.files[0]); fileInput.value = ''; } });
  const pickBtn = el('button', { class: 'btn', type: 'button', text: 'Choose file', onclick: () => fileInput.click() });
  const drop = el('div', { class: 'dropzone', id: 'transcript-drop' },
    el('p', null, el('strong', { text: 'Drop a transcript here' })), el('p', { class: 'muted small', text: '.json, .srt, .vtt or .txt. A new upload replaces the earlier one.' }), pickBtn, fileInput);
  wireDrop(drop, (files) => files[0] && sendTranscript(files[0]));

  const paste = el('textarea', { id: 'paste-text', rows: 5, placeholder: 'Paste the transcript text here', 'aria-label': 'Paste transcript' });
  const pasteBtn = el('button', { class: 'btn', type: 'button', id: 'paste-send', text: 'Use pasted text', onclick: () => {
    const t = paste.value.trim();
    if (!t) return toast('Paste some text first', 'error');
    sendTranscript(new Blob([t], { type: 'text/plain' }), 'pasted.txt').then((ok) => { if (ok) paste.value = ''; });
  } });
  const result = el('div', { id: 'parse-result', 'aria-live': 'polite' });

  async function sendTranscript(file, name) {
    if (!project || locked()) return false;
    const r = await act(null, async () => {
      busy = true;
      setLocked();
      try { return await api.upload('/projects/' + pid + '/transcript', file, name); } finally { busy = false; }
    }, 'Transcript parsed');
    if (r.ok) {
      lastFormat = r.value.format;
      project = Object.assign({}, project, { word_count: r.value.word_count, duration_ms: r.value.duration_ms, warnings: r.value.warnings });
      watcher.now();
    }
    render();
    return r.ok;
  }

  // ---- images block
  const imgInput = el('input', { type: 'file', id: 'image-file', accept: 'image/*', multiple: true, class: 'sr-only', onchange: () => { sendImages([...imgInput.files]); imgInput.value = ''; } });
  const imgBtn = el('button', { class: 'btn', type: 'button', text: 'Add images', onclick: () => imgInput.click() });
  const imgDrop = el('div', { class: 'dropzone', id: 'image-drop' }, el('p', { class: 'muted small', text: 'Optional. Drop images here or add them; the agents can use them in scenes.' }), imgBtn, imgInput);
  wireDrop(imgDrop, (files) => sendImages(files));
  const thumbs = el('div', { class: 'thumbs', id: 'media-list' });

  async function sendImages(files) {
    if (!project || locked()) return;
    files = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name));
    if (!files.length) return toast('Choose image files', 'error');
    busy = true;
    setLocked();
    let n = 0;
    for (const f of files) {
      const r = await act(null, () => api.upload('/projects/' + pid + '/media', f));
      if (!r.ok) break;
      n++;
    }
    busy = false;
    if (n) toast(n === 1 ? 'Image added' : n + ' images added', 'ok');
    watcher.now();
    setLocked();
  }

  const cont = el('button', { class: 'btn btn-primary', type: 'button', id: 'continue', text: 'Continue to planning', onclick: () => { location.hash = '#/p/' + pid + (locked() ? '/beats' : '/plan'); } });
  const lockNote = el('div', { class: 'note note-warn', hidden: true, text: 'The plan is approved, so the setup is locked.' });

  view.append(
    el('div', { class: 'page-head' }, el('h2', { text: 'Setup' })),
    lockNote,
    el('section', { class: 'card stack', 'aria-labelledby': 'h-tr' }, el('h3', { id: 'h-tr', text: '1. Transcript' }), drop,
      el('div', null, el('label', { for: 'paste-text', text: 'Or paste instead' }), paste, el('div', { style: 'margin-top:8px' }, pasteBtn)), result),
    el('section', { class: 'card stack', style: 'margin-top:14px', 'aria-labelledby': 'h-im' }, el('h3', { id: 'h-im', text: '2. Images (optional)' }), imgDrop, thumbs),
    el('div', { class: 'row', style: 'margin-top:14px' }, cont, el('span', { class: 'hint', id: 'cont-hint' })));

  function wireDrop(zone, onFiles) {
    for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); if (!locked()) zone.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
    zone.addEventListener('drop', (e) => { if (!locked() && e.dataTransfer && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  }
  const locked = () => !!(project && project.plan_approved);

  function setLocked() {
    const l = locked();
    for (const n of [pickBtn, pasteBtn, imgBtn, paste, fileInput, imgInput]) n.disabled = l || busy || !project;
    for (const z of [drop, imgDrop]) z.setAttribute('aria-disabled', String(l));
    lockNote.hidden = !l;
    for (const b of thumbs.querySelectorAll('button.del')) b.disabled = l;
    cont.textContent = l ? 'Go to beats' : 'Continue to planning';
    cont.disabled = !project || (!l && !(project.word_count > 0));
    view.querySelector('#cont-hint').textContent = !l && project && !project.word_count ? 'Upload a transcript first.' : '';
  }

  function render() {
    if (!project) return;
    app.setTop({ title: project.name, pid });
    const p = project;
    if (!p.word_count) result.replaceChildren(el('p', { class: 'muted', text: 'No transcript yet.' }));
    else {
      const warn = (p.warnings || []).map((w) => /interpolat/i.test(w)
        ? el('div', { class: 'note note-warn', 'data-kind': 'interpolation' }, el('strong', { text: 'Word sync will be weaker. ' }), w)
        : el('div', { class: 'note', text: w }));
      result.replaceChildren(el('dl', { class: 'kv' },
        el('dt', { text: 'Format' }), el('dd', { text: lastFormat || 'uploaded' }),
        el('dt', { text: 'Words' }), el('dd', { text: String(p.word_count) }),
        el('dt', { text: 'Duration' }), el('dd', { text: fmtMs(p.duration_ms) })), ...warn);
    }
    const sig = JSON.stringify(p.media.map((m) => m.id));
    if (sig !== mediaSig) {
      mediaSig = sig;
      thumbs.replaceChildren(...p.media.map((m) => el('div', { class: 'card thumb', dataset: { mid: m.id } },
        el('button', { class: 'img', type: 'button', 'aria-label': 'Preview ' + m.filename, onclick: () => lightbox(m.url, m.filename) }, el('img', { src: m.url, alt: m.filename, loading: 'lazy' })),
        el('div', { class: 'name', title: m.filename, text: m.filename }), el('div', { class: 'hint', text: fmtBytes(m.bytes) }),
        el('button', { class: 'btn btn-sm btn-danger del', type: 'button', text: 'Delete', 'aria-label': 'Delete ' + m.filename, onclick: async (e) => {
          if (!(await confirmDialog({ title: 'Delete image?', message: m.filename + ' will be removed from this project.', ok: 'Delete', danger: true }))) return;
          const r = await act(e.currentTarget, () => api.del('/projects/' + pid + '/media/' + m.id), 'Image deleted');
          if (r.ok) watcher.now();
        } }))));
      if (!p.media.length) thumbs.replaceChildren(el('p', { class: 'muted', text: 'No images.' }));
    }
    setLocked();
  }

  setLocked(); // controls stay disabled until the project has loaded
  const watcher = watchProject(pid, ({ project: p }) => {
    if (dead) return;
    project = p;
    render();
  });
  return () => { dead = true; watcher.stop(); };
}
