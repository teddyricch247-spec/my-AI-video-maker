import { api } from '../api.js';
import { el, act, toast, confirmDialog, money } from '../ui.js';

function picker({ id, label, models, value, onChange, needs }) {
  let current = value;
  const search = el('input', { type: 'search', id: id + '-search', placeholder: 'Search models', 'aria-label': 'Search ' + label + ' models' });
  const ul = el('ul', { role: 'listbox', 'aria-label': label + ' model', id });
  const warn = el('div', { id: id + '-warn' });
  const cap = (on, text) => el('span', { class: 'chip ' + (on ? 'chip-ok' : ''), text: (on ? '' : 'no ') + text });

  function warnings() {
    const m = models.find((x) => x.id === current);
    const msgs = [];
    if (m) {
      if (needs.tools && !m.supports_tools) msgs.push('This model does not support tools, so ' + label + ' work will fail.');
      if (needs.images && !m.supports_images) msgs.push('This model cannot read images, so scene frames cannot be reviewed.');
    }
    warn.replaceChildren(...msgs.map((t) => el('div', { class: 'note note-warn', role: 'alert', text: t })));
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    ul.replaceChildren(...models.filter((m) => !q || (m.name + ' ' + m.id).toLowerCase().includes(q)).map((m) =>
      el('li', { role: 'none' }, el('button', { type: 'button', role: 'option', 'aria-selected': String(m.id === current), 'data-id': m.id, onclick: () => { current = m.id; onChange(m.id); draw(); } },
        el('span', { text: m.name }), el('span', { class: 'row', style: 'gap:6px' }, cap(m.supports_tools, 'tools'), cap(m.supports_images, 'vision'),
          el('span', { class: 'small', text: '$' + m.price_in + ' / $' + m.price_out + ' per 1M' }))))));
    if (!ul.children.length) ul.append(el('li', { class: 'muted', style: 'padding:10px 12px', text: 'No models match.' }));
    warnings();
  }
  search.addEventListener('input', draw);
  draw();
  return { el: el('div', { class: 'field' }, el('label', { for: id + '-search', text: label + ' model' }), el('div', { class: 'picker' }, search, ul), warn), get: () => current };
}

function numField(id, label, value, props) {
  const input = el('input', Object.assign({ type: 'number', id, value: String(value) }, props));
  return { input, el: el('div', null, el('label', { for: id, text: label }), input) };
}

export async function mount(view, params, app) {
  let dead = false;
  view.append(el('div', { class: 'page-head' }, el('h2', { text: 'Settings' })), el('p', { class: 'muted', text: 'Loading...' }));
  let models;
  let s;
  try {
    [models, s] = await Promise.all([api.get('/models'), api.get('/settings')]);
  } catch (e) {
    if (e.status !== 401) view.replaceChildren(el('div', { class: 'note note-err', text: e.message }));
    return () => {};
  }
  if (dead) return () => {};
  app.applySettings(s);

  const save = async (btn, body, label) => {
    const r = await act(btn, () => api.put('/settings', body), label + ' saved');
    if (r.ok) { s = r.value; app.applySettings(s); spend.textContent = money(s.spend_today_usd); }
    return r.ok;
  };

  // models
  const dir = picker({ id: 'pick-director', label: 'Director', models, value: s.models.director, onChange: () => {}, needs: { tools: true } });
  const beat = picker({ id: 'pick-beat', label: 'Beat', models, value: s.models.beat, onChange: () => {}, needs: { tools: true, images: true } });
  const saveModels = el('button', { class: 'btn btn-primary', type: 'button', id: 'save-models', text: 'Save models', onclick: () => save(saveModels, { models: { director: dir.get(), beat: beat.get() } }, 'Models') });

  // caps
  const caps = [['run_usd', 'Max spend per run (USD)', { min: 0, step: 0.5 }], ['daily_usd', 'Max spend per day (USD)', { min: 0, step: 0.5 }], ['max_steps', 'Max steps per beat', { min: 1, step: 1 }], ['max_minutes', 'Max minutes per beat', { min: 1, step: 1 }]]
    .map(([k, l, p]) => ({ k, f: numField('cap-' + k, l, s.caps[k], p) }));
  const saveCaps = el('button', { class: 'btn btn-primary', type: 'button', id: 'save-caps', text: 'Save caps', onclick: () => {
    const out = {};
    for (const { k, f } of caps) {
      const v = Number(f.input.value);
      if (!isFinite(v) || v < 0 || f.input.value === '') return toast('Enter a valid number for ' + f.el.querySelector('label').textContent, 'error');
      out[k] = v;
    }
    save(saveCaps, { caps: out }, 'Caps');
  } });

  // runtime
  const conc = numField('beat-concurrency', 'Beat concurrency (1 to 4)', s.beat_concurrency, { min: 1, max: 4, step: 1 });
  const peak = numField('sfx-peak', 'SFX peak level (dBFS, -12 to -1)', s.sfx_peak_dbfs, { min: -12, max: -1, step: 1 });
  const saveRun = el('button', { class: 'btn btn-primary', type: 'button', id: 'save-runtime', text: 'Save', onclick: () => {
    const c = Number(conc.input.value);
    const p = Number(peak.input.value);
    if (!Number.isInteger(c) || c < 1 || c > 4) return toast('Concurrency must be a whole number from 1 to 4', 'error');
    if (!isFinite(p) || p < -12 || p > -1) return toast('Peak must be between -12 and -1 dBFS', 'error');
    save(saveRun, { beat_concurrency: c, sfx_peak_dbfs: p }, 'Runtime settings');
  } });

  // kill switch
  const kill = el('button', { class: 'switch', type: 'button', role: 'switch', id: 'kill-switch', 'aria-checked': String(!!s.kill_switch), onclick: async () => {
    const on = kill.getAttribute('aria-checked') !== 'true';
    const ok = await confirmDialog(on
      ? { title: 'Turn the kill switch ON?', message: 'All agent work stops immediately until you turn it off again.', ok: 'Stop everything', danger: true }
      : { title: 'Turn the kill switch off?', message: 'Agents may start working again.', ok: 'Turn off' });
    if (!ok) return;
    const r = await act(kill, () => api.post('/kill', { on }), on ? 'Kill switch is on' : 'Kill switch is off');
    if (r.ok) { s = r.value; app.applySettings(s); kill.setAttribute('aria-checked', String(!!s.kill_switch)); killState.textContent = s.kill_switch ? 'ON: all work stopped' : 'Off'; }
  } }, el('span', { id: 'kill-state', text: s.kill_switch ? 'ON: all work stopped' : 'Off' }), el('span', { class: 'knob' }));
  const killState = kill.querySelector('#kill-state');

  const spend = el('strong', { id: 'spend-today', text: money(s.spend_today_usd) });
  const logout = el('button', { class: 'btn', type: 'button', id: 'logout', text: 'Log out', onclick: async () => {
    const r = await act(logout, () => api.post('/logout'));
    if (r.ok) location.hash = '#/login';
  } });

  const sec = (h, ...kids) => el('section', { class: 'card stack', style: 'margin-bottom:14px' }, el('h3', { text: h }), ...kids);
  view.replaceChildren(
    el('div', { class: 'page-head' }, el('h2', { text: 'Settings' }), el('span', { class: 'spacer' }), el('span', { class: 'muted' }, 'Spent today: ', spend)),
    sec('Models', dir.el, beat.el, el('div', null, saveModels)),
    sec('Spending caps', el('div', { class: 'caps' }, caps.map((c) => c.f.el)), el('div', null, saveCaps)),
    sec('Runtime', conc.el, el('div', { class: 'hint', text: 'Sessions run one after another by default.' }), peak.el, el('div', null, saveRun)),
    sec('Kill switch', el('p', { class: 'muted', text: 'Emergency stop for every agent.' }), kill),
    sec('Account', el('div', null, logout)));
  return () => { dead = true; };
}
