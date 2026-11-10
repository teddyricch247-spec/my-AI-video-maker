// Hash router. Pages are lazy modules exporting mount(view, params, app) -> dispose().
import { el } from './ui.js';

const ROUTES = [
  [/^#\/login$/, 'login', () => ({})],
  [/^#\/projects$/, 'projects', () => ({})],
  [/^#\/p\/([\w-]+)\/(setup|plan|beats|export)$/, null, (m) => ({ pid: m[1], tab: m[2] })],
  [/^#\/b\/([\w-]+)$/, 'beat', (m) => ({ bid: m[1] })],
  [/^#\/settings$/, 'settings', () => ({})],
];

export function matchRoute(hash) {
  for (const [re, page, params] of ROUTES) {
    const m = re.exec(hash);
    if (m) {
      const p = params(m);
      return { page: page || p.tab, params: p, hash };
    }
  }
  return null;
}

export function startRouter(app, view) {
  let dispose = null;
  let token = 0;

  async function render() {
    const my = ++token;
    if (dispose) {
      try { dispose(); } catch (e) { console.warn('dispose failed', e); }
      dispose = null;
    }
    view.replaceChildren();
    const r = matchRoute(location.hash || '');
    if (!r) {
      location.replace('#/projects');
      return;
    }
    app.setTop({ route: r });
    let mod;
    try {
      mod = await import('./pages/' + r.page + '.js');
    } catch (e) {
      view.replaceChildren(el('div', { class: 'note note-err', text: 'Could not load this page: ' + e.message }));
      return;
    }
    if (my !== token) return;
    try {
      const d = await mod.mount(view, r.params, app);
      if (my !== token) {
        if (d) d();
        return;
      }
      dispose = d || null;
    } catch (e) {
      console.error(e);
      view.replaceChildren(el('div', { class: 'note note-err', text: 'Something broke on this page: ' + e.message }));
    }
    app.onRoute(r);
  }

  addEventListener('hashchange', render);
  render();
}
