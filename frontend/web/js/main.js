// Boot: top bar, global banners (kill switch), settings refresh, router.
import { api } from './api.js';
import { startRouter } from './router.js';
import { el, setBanner } from './ui.js';

const TABS = [['setup', 'Setup'], ['plan', 'Plan'], ['beats', 'Beats'], ['export', 'Export']];
const topbar = document.getElementById('topbar');
const tabsNav = document.getElementById('tb-tabs');
const titleEl = document.getElementById('tb-title');
const backEl = document.getElementById('tb-back');
const view = document.getElementById('view');

let lastSettings = null;
let lastSettingsAt = 0;

const app = {
  pid: null,
  get settings() { return lastSettings; },

  /** Router calls this before mounting. Pages refine with setTop({title, pid, tab, back}). */
  setTop(o) {
    if (o.route) {
      const { page, params } = o.route;
      topbar.hidden = page === 'login';
      this.pid = params.pid || null;
      this.currentTab = params.tab || (page === 'beat' ? 'beats' : null);
      titleEl.textContent = page === 'settings' ? 'Settings' : page === 'projects' ? 'Projects' : 'vbeat';
      document.title = titleEl.textContent + ' - vbeat';
      backEl.setAttribute('href', '#/projects'); // the beat page overrides this with its project's Beats tab
      backEl.hidden = page === 'projects';
      this.renderTabs();
      return;
    }
    if (o.title != null) {
      titleEl.textContent = o.title;
      document.title = o.title + ' - vbeat';
    }
    if (o.back) backEl.setAttribute('href', o.back);
    if (o.pid) {
      this.pid = o.pid;
      this.renderTabs();
    }
  },

  renderTabs() {
    tabsNav.hidden = !this.pid;
    if (!this.pid) return;
    const key = this.pid + '|' + this.currentTab;
    if (tabsNav.dataset.key === key) return;
    tabsNav.dataset.key = key;
    tabsNav.replaceChildren(...TABS.map(([id, label]) =>
      el('a', { href: '#/p/' + this.pid + '/' + id, 'aria-current': id === this.currentTab ? 'page' : null, text: label })));
  },

  onRoute(r) {
    if (r.page !== 'login' && Date.now() - lastSettingsAt > 15000) this.refreshSettings();
  },

  async refreshSettings() {
    lastSettingsAt = Date.now();
    try {
      lastSettings = await api.get('/settings', { quiet: true });
      this.applySettings(lastSettings);
    } catch (e) { /* offline or logged out: leave banner as it was */ }
  },

  applySettings(s) {
    lastSettings = s;
    lastSettingsAt = Date.now();
    setBanner('kill', s && s.kill_switch
      ? ['Kill switch is ON: all agent work is stopped. ', el('a', { href: '#/settings', text: 'Open settings' })]
      : null, 'kill');
  },
};

setInterval(() => {
  if (!document.hidden && !location.hash.startsWith('#/login')) app.refreshSettings();
}, 30000);

startRouter(app, view);
