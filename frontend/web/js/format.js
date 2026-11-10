// Pure helpers: number/time formatting, URL guard and the tiny safe rich-text formatter.
// Nothing in here ever builds markup from strings: output is always DOM nodes + textContent.

export function fmtMoney(n) {
  const v = Number(n) || 0;
  return '$' + (v < 1 && v > 0 ? v.toFixed(3) : v.toFixed(2));
}

export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function fmtDuration(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? m + 'm ' + String(Math.floor(s)).padStart(2, '0') + 's' : s.toFixed(1) + 's';
}

export function fmtMs(ms) {
  return fmtDuration((Number(ms) || 0) / 1000);
}

/** "mm:ss.ff" where ff is the frame inside the second. Frame n sits at n/fps. */
export function fmtClock(t, fps) {
  const n = Math.max(0, Math.round(t * fps));
  const sec = Math.floor(n / fps);
  const ff = n - sec * fps;
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') + '.' + String(ff).padStart(2, '0');
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many || one + 's');
}

/** Quantise to a frame boundary: frame n is at n / fps. */
export function quantise(t, fps, frames) {
  const n = Math.min(Math.max(0, Math.round(t * fps)), Math.max(0, frames - 1));
  return { n, t: n / fps };
}

// URLs from the API are opaque but still rendered into src/href, so only same-origin paths, http(s) and fragments pass.
const SAFE_URL = /^(\/(?!\/)|#|https?:\/\/)/i;
export function safeUrl(u) {
  u = typeof u === 'string' ? u.trim() : '';
  return SAFE_URL.test(u) ? u : '';
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function inline(parent, s) {
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parent.append(document.createTextNode(s.slice(last, m.index)));
    if (m[1]) parent.append(node('code', '', m[1].slice(1, -1)));
    else parent.append(node('strong', '', m[2].slice(2, -2)));
    last = re.lastIndex;
  }
  if (last < s.length) parent.append(document.createTextNode(s.slice(last)));
}

/**
 * Safe formatter for untrusted agent text: paragraphs, ``` fenced code, `inline code`, **bold**.
 * Everything else is shown literally. Returns a <div class="rich"> element.
 */
export function rich(text) {
  const root = node('div', 'rich');
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  const flush = () => {
    if (para.length) {
      const p = node('p');
      inline(p, para.join('\n'));
      root.append(p);
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*```\s*([\w+-]*)\s*$/.exec(lines[i]);
    if (open) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      const pre = node('pre');
      if (open[1]) pre.dataset.lang = open[1];
      pre.append(node('code', '', code.join('\n')));
      root.append(pre);
    } else if (lines[i].trim() === '') {
      flush();
    } else {
      para.push(lines[i]);
    }
  }
  flush();
  return root;
}
