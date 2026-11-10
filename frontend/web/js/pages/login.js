import { api, takeReturnTo } from '../api.js';
import { el, act } from '../ui.js';

export async function mount(view, params, app) {
  const err = el('div', { class: 'err-text', role: 'alert' });
  const pw = el('input', { type: 'password', id: 'pw', name: 'password', autocomplete: 'current-password', required: true, 'aria-describedby': 'login-err' });
  err.id = 'login-err';
  const btn = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Log in' });
  const form = el('form', { class: 'login stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const r = await act(btn, async () => {
      try {
        await api.post('/login', { password: pw.value }, { noRedirect: true });
      } catch (x) {
        if (x.status === 401) throw new Error('Wrong password. Try again.');
        throw x;
      }
    });
    if (!r.ok) {
      err.textContent = r.error && r.error.message ? r.error.message : 'Login failed';
      pw.select();
      return;
    }
    app.refreshSettings();
    const back = takeReturnTo();
    location.hash = back && !back.startsWith('#/login') ? back : '#/projects';
  } },
  el('h2', { text: 'vbeat' }),
  el('p', { class: 'muted', text: 'Turn a transcript into short animated beats.' }),
  el('div', { class: 'field' }, el('label', { for: 'pw', text: 'Password' }), pw),
  err, btn);
  view.append(form);
  pw.focus();
  return () => {};
}
