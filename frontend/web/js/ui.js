// DOM helpers shared by every page: el(), toasts, confirm dialog, lightbox, banners, chips, progress bars.
import { safeUrl, fmtMoney } from './format.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'type', 'min', 'max', 'step', 'rows', 'multiple', 'selected', 'open', 'tabIndex', 'readOnly']);

/** el('div', {class:'x', onclick: fn, 'aria-label': 'y'}, 'text', childNode, [more]) -> HTMLElement. Never parses markup. */
export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) n[k] = v;
      else if (k === 'src' || k === 'href') {
        const u = safeUrl(v);
        if (u) n.setAttribute(k, u);
      } else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(n, kids);
  return n;
}

export function append(parent, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(parent, k);
    else parent.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return parent;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---- toasts
export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  const t = el('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status', text: message });
  host.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

// ---- banners (kill switch, waking the server)
export function setBanner(id, content, cls) {
  const host = document.getElementById('banners');
  let b = host.querySelector('[data-banner="' + id + '"]');
  if (!content) {
    if (b) b.remove();
    return;
  }
  if (!b) {
    b = el('div', { class: 'banner ' + cls, role: 'status', dataset: { banner: id } });
    host.append(b);
  }
  b.replaceChildren(...(Array.isArray(content) ? content : [content]).map((c) => (c instanceof Node ? c : document.createTextNode(c))));
}

// ---- dialogs
export function confirmDialog({ title, message, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = el('dialog', { 'aria-label': title },
      el('h2', { text: title }),
      el('p', { class: 'muted', text: message }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => d.close('cancel') }),
        el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', text: ok, 'data-confirm': 'ok', onclick: () => d.close('ok') })));
    d.addEventListener('close', () => {
      d.remove();
      resolve(d.returnValue === 'ok');
    });
    document.body.append(d);
    d.showModal();
  });
}

export function lightbox(url, alt = '') {
  const u = safeUrl(url);
  if (!u) return;
  const d = el('dialog', { class: 'lightbox', 'aria-label': 'Image preview' },
    el('img', { src: u, alt }),
    el('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => d.close() }));
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

/** Run an async action with a disabled button; errors become toasts (401 is handled by the router). */
export async function act(btn, fn, okMessage) {
  if (btn) btn.disabled = true;
  try {
    const value = await fn();
    if (okMessage) toast(okMessage, 'ok');
    return { ok: true, value };
  } catch (e) {
    if (e && e.status !== 401) toast((e && e.message) || 'Something went wrong', 'error');
    return { ok: false, error: e };
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

// ---- chips, bars, small widgets
const LABEL = {
  queued: 'Queued', running: 'Running', waiting_user: 'Needs review', needs_attention: 'Needs attention', approved: 'Approved',
  failed: 'Failed', skipped: 'Skipped', setup: 'Setup', planning: 'Planning', plan_ready: 'Plan ready', building: 'Building', done: 'Done',
  idle: 'Idle', flagged: 'Flagged',
};
const KIND = { approved: 'chip-ok', done: 'chip-ok', waiting_user: 'chip-warn', needs_attention: 'chip-warn', plan_ready: 'chip-warn', failed: 'chip-bad', running: 'chip-run', building: 'chip-run', planning: 'chip-run' };

export const statusLabel = (s) => LABEL[s] || String(s);
export function statusChip(status) {
  return el('span', { class: 'chip ' + (KIND[status] || ''), 'data-status': status, text: statusLabel(status) });
}
export function setChip(node, status) {
  if (node.dataset.status === status) return;
  node.dataset.status = status;
  node.className = 'chip ' + (KIND[status] || '');
  node.textContent = statusLabel(status);
}

export function modeChip(mode) {
  return el('span', { class: 'chip', text: mode });
}

export function progressBar(done, total, label) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done, 'aria-label': label || 'Progress' }, el('i'));
  bar.firstChild.style.width = pct + '%';
  return bar;
}
export function setProgress(bar, done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  bar.firstChild.style.width = pct + '%';
  bar.setAttribute('aria-valuenow', done);
  bar.setAttribute('aria-valuemax', total);
}

export const money = (n) => fmtMoney(n);

/** Set text only when it changed (keeps selection and avoids layout churn during polling). */
export function setText(node, text) {
  text = text == null ? '' : String(text);
  if (node.textContent !== text) node.textContent = text;
}

export function emptyState(title, text) {
  return el('div', { class: 'empty' }, el('h3', { text: title }), text ? el('p', { text }) : null);
}

export function notes(list, cls) {
  return list.map((t) => el('div', { class: 'note ' + (cls || ''), text: t }));
}
