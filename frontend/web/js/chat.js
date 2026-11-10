// Chat component shared by the Director (Plan page) and each beat (Beat page).
// createChat({sessionId, quick, readOnly, onSession}) -> {el, destroy, setReadOnly, session()}
import { api } from './api.js';
import { poll } from './poller.js';
import { el, act, lightbox, money } from './ui.js';
import { rich } from './format.js';

const drafts = new Map(); // sessionId -> unsent text; survives page changes within the tab
const BUSY = new Set(['queued', 'running']);
const FAST_MS = 2000;
const SLOW_MS = 8000;

export function createChat({ sessionId, quick = [], readOnly = false, readOnlyNote = '', onSession = null }) {
  let sid = sessionId;
  let session = null;
  let lastSeq = 0;
  let sending = false;
  let fastUntil = 0;
  let destroyed = false;
  const nodes = new Map(); // seq -> {node, queuedBadge?, msg}

  const list = el('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation', tabindex: '0' });
  const working = el('div', { class: 'working', hidden: true, role: 'status' });
  const input = el('textarea', { rows: 1, 'aria-label': 'Message', placeholder: 'Write a message (Enter sends, Shift+Enter adds a line)', maxlength: 4000 });
  const sendBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Send' });
  const note = el('div', { class: 'hint', hidden: !readOnly, text: readOnlyNote });
  const quickRow = el('div', { class: 'quick' }, quick.map((q) => el('button', { class: 'btn', type: 'button', text: q.label, onclick: (e) => send(q.text, e.currentTarget) })));
  const form = el('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); send(input.value, sendBtn); } }, input, sendBtn);
  const root = el('section', { class: 'chat', 'aria-label': 'Chat' }, list, working, quick.length ? quickRow : null, form, note);

  input.value = drafts.get(sid) || '';
  const grow = () => { input.style.height = '44px'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; };
  input.addEventListener('input', () => { drafts.set(sid, input.value); grow(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  queueMicrotask(grow);

  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const toBottom = () => { list.scrollTop = list.scrollHeight; };

  function stepRow(s) {
    const body = el('div', { class: 'body' }, (s.image_urls || []).map((u) => el('img', { src: u, alt: 'Step image', loading: 'lazy', onclick: () => lightbox(u, s.name) })));
    const d = el('details', { class: 'step', 'data-ok': String(!!s.ok) },
      el('summary', null, el('span', { class: 'mark ' + (s.ok ? 'ok' : 'bad'), 'aria-label': s.ok ? 'ok' : 'failed', text: s.ok ? '✓' : '✗' }),
        el('span', { class: 'name', text: s.name }), el('span', { class: 'sum', text: s.summary })));
    if ((s.image_urls || []).length) d.append(body);
    return d;
  }

  function renderMsg(m) {
    if (m.role === 'event') return { node: el('div', { class: 'msg event', 'data-seq': m.seq, text: m.text }) };
    const parts = [];
    let badge = null;
    if (m.text) {
      const bubble = el('div', { class: 'msg ' + m.role, 'data-seq': m.seq }, rich(m.text));
      if (m.role === 'user' && m.queued) {
        badge = el('span', { class: 'badge', text: 'queued' });
        bubble.append(badge);
      }
      parts.push(bubble);
    }
    if (m.steps && m.steps.length) parts.push(el('div', { class: 'steps', 'data-seq': m.seq }, m.steps.map(stepRow)));
    const node = parts.length === 1 ? parts[0] : el('div', { class: 'grp', style: 'display:contents', 'data-seq': m.seq }, parts);
    return { node, badge };
  }

  function upsert(m) {
    const old = nodes.get(m.seq);
    if (old && !old.msg.queued) return; // immutable once not queued
    const r = renderMsg(m);
    r.msg = m;
    if (old) {
      old.node.replaceWith(r.node);
    } else {
      // keep seq order even if responses race
      let before = null;
      for (const [s, n] of nodes) if (s > m.seq && (!before || s < before.seq)) before = { seq: s, node: n.node };
      list.insertBefore(r.node, before ? before.node : working.parentNode === list ? working : null);
    }
    nodes.set(m.seq, r);
    lastSeq = Math.max(lastSeq, m.seq);
  }

  function applySession(s) {
    session = s;
    const busy = BUSY.has(s.status);
    working.hidden = !busy;
    if (busy) working.replaceChildren(el('span', { class: 'pulse', text: s.status === 'queued' ? 'Queued...' : 'Working...' }), el('span', { text: s.steps + ' steps · ' + money(s.cost_usd) }));
    if (onSession) onSession(s);
  }

  async function fetchMessages(isStopped) {
    const queued = [...nodes.values()].filter((n) => n.msg.queued).map((n) => n.msg.seq);
    const after = queued.length ? Math.min(...queued) - 1 : lastSeq; // re-read from the oldest still-queued message so its badge can clear
    const r = await api.get('/sessions/' + encodeURIComponent(sid) + '/messages?after_seq=' + after, { alive: () => !isStopped() && !destroyed });
    if (isStopped() || destroyed) return;
    const stick = nearBottom() || lastSeq === 0;
    for (const m of r.messages) upsert(m);
    applySession(r.session);
    if (stick && r.messages.length) toBottom();
  }

  const poller = poll(fetchMessages, () => (Date.now() < fastUntil || (session && BUSY.has(session.status)) ? FAST_MS : SLOW_MS));

  async function send(text, btn) {
    text = String(text || '').trim();
    if (!text || sending || readOnly) return;
    sending = true;
    sendBtn.disabled = true;
    const r = await act(null, () => api.post('/sessions/' + encodeURIComponent(sid) + '/messages', { text }));
    sending = false;
    sendBtn.disabled = readOnly;
    if (!r.ok) return;
    if (btn === sendBtn || document.activeElement === input) {
      input.value = '';
      drafts.delete(sid);
      grow();
    }
    upsert(r.value.message);
    toBottom();
    fastUntil = Date.now() + 15000;
    poller.now();
  }

  function setReadOnly(v, noteText) {
    readOnly = v;
    input.disabled = v;
    sendBtn.disabled = v || sending;
    for (const b of quickRow.querySelectorAll('button')) b.disabled = v;
    note.hidden = !v;
    if (noteText != null) note.textContent = noteText;
  }
  setReadOnly(readOnly, readOnlyNote);

  return {
    el: root,
    session: () => session,
    setReadOnly,
    refresh: () => poller.now(),
    destroy() { destroyed = true; poller.stop(); },
  };
}
