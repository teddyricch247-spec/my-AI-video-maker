import { api } from '../api.js';
import { poll } from '../poller.js';
import { el, act, statusChip, confirmDialog, emptyState, money } from '../ui.js';
import { fmtDate } from '../format.js';

const SIZES = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];

function entryHash(p) {
  const tab = p.status === 'setup' ? 'setup' : p.status === 'planning' || p.status === 'plan_ready' ? 'plan' : 'beats';
  return '#/p/' + p.id + '/' + tab;
}

export async function mount(view, params, app) {
  let sig = '';
  let loaded = false;
  const list = el('div', { class: 'grid', 'aria-label': 'Projects' });
  const empty = el('div', { hidden: true }, emptyState('No projects yet', 'Create one to upload a transcript and start planning beats.'));
  const form = buildForm();
  const newBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'new-project', text: 'New project', 'aria-expanded': 'false', onclick: () => {
    form.hidden = !form.hidden;
    newBtn.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) form.querySelector('input[name=name]').focus();
  } });
  view.append(el('div', { class: 'page-head' }, el('h2', { text: 'Projects' }), el('span', { class: 'spacer' }), newBtn), form, list, empty);

  function buildForm() {
    const name = el('input', { type: 'text', name: 'name', id: 'np-name', required: true, maxlength: 80, placeholder: 'e.g. Launch video' });
    const fps = el('select', { name: 'fps', id: 'np-fps' }, [24, 25, 30, 60].map((v) => el('option', { value: String(v), selected: v === 30, text: v + ' fps' })));
    const size = el('select', { name: 'size', id: 'np-size' }, SIZES.map(([w, h]) => el('option', { value: w + 'x' + h, selected: w === 1920, text: w + ' x ' + h })));
    const sfx = el('input', { type: 'checkbox', name: 'sfx', checked: true });
    const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Create project' });
    const f = el('form', { class: 'card newform stack', hidden: true, onsubmit: async (e) => {
      e.preventDefault();
      const [w, h] = size.value.split('x').map(Number);
      const r = await act(submit, () => api.post('/projects', { name: name.value.trim(), fps: Number(fps.value), width: w, height: h, sfx_enabled: sfx.checked }));
      if (r.ok) location.hash = '#/p/' + r.value.id + '/setup';
    } },
    el('div', { class: 'field' }, el('label', { for: 'np-name', text: 'Name' }), name),
    el('div', { class: 'two' },
      el('div', null, el('label', { for: 'np-fps', text: 'Frame rate' }), fps),
      el('div', null, el('label', { for: 'np-size', text: 'Export size' }), size)),
    el('label', { class: 'check' }, sfx, 'Generate sound effects'),
    el('div', { class: 'row' }, submit, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => { f.hidden = true; newBtn.setAttribute('aria-expanded', 'false'); } })));
    return f;
  }

  function card(p) {
    const total = Object.values(p.beat_counts || {}).reduce((a, b) => a + b, 0);
    const del = el('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete', 'aria-label': 'Delete project ' + p.name, onclick: async () => {
      const ok = await confirmDialog({ title: 'Delete project?', message: '"' + p.name + '" and all its beats will be permanently removed.', ok: 'Delete', danger: true });
      if (!ok) return;
      const r = await act(del, () => api.del('/projects/' + p.id), 'Project deleted');
      if (r.ok) load();
    } });
    return el('article', { class: 'card pcard', dataset: { pid: p.id } },
      el('div', { class: 'row' }, el('h3', null, el('a', { href: entryHash(p), text: p.name })), el('span', { class: 'spacer' }), statusChip(p.status)),
      el('div', { class: 'meta' },
        el('span', { text: (p.beat_counts ? p.beat_counts.approved : 0) + ' / ' + total + ' beats approved' }),
        el('span', { text: money(p.cost_usd) }),
        el('span', { text: p.width + 'x' + p.height + ' @ ' + p.fps }),
        el('span', { text: fmtDate(p.created_at) })),
      el('div', { class: 'row' }, el('a', { class: 'btn btn-sm', href: entryHash(p), text: 'Open' }), del));
  }

  async function load() {
    const ps = await api.get('/projects');
    loaded = true;
    const s = JSON.stringify(ps);
    if (s === sig) return;
    sig = s;
    list.replaceChildren(...ps.map(card));
    empty.hidden = ps.length > 0;
  }

  const p = poll(load, () => (document.hidden ? 15000 : 5000));
  return () => p.stop();
}
