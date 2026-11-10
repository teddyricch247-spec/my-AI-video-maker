// Preview player (parent side). The parent owns the clock; the sandboxed iframe only draws the frame it is told to.
// createPreview({beat, words, fps?}) -> {el, load(bundle), setBundle, destroy, state}
import { el } from './ui.js';
import { fmtClock, quantise } from './format.js';

const READY_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 20000;

export function createPreview({ beat, words = [] }) {
  let bundle = null;
  let fps = 30;
  let frames = 0;
  let dur = 0;
  let curN = 0; // current frame index
  let playing = false;
  let loop = false;
  let muted = false;
  let raf = 0;
  let t0perf = 0; // own-timer origin
  let t0 = 0;
  let useAudio = false;
  let audio = null;
  let loadedOnce = false;
  let ready = false;
  let timer = 0;
  let errCount = 0;
  let wordIdx = -1;
  let destroyed = false;
  let sentN = -1;

  // ---- DOM
  const frame = el('iframe', { class: 'pv-frame', title: 'Scene preview', sandbox: 'allow-scripts', src: '/preview-frame.html', 'data-testid': 'preview-frame' });
  const msg = el('div', { class: 'pv-msg', role: 'status', text: 'Loading preview...' });
  const stage = el('div', { class: 'pv-stage', 'data-state': 'loading' }, frame, msg);
  const errBox = el('div', { class: 'pv-error', role: 'alert', hidden: true, id: 'pv-error' });
  const audioNote = el('div', { class: 'hint', hidden: true });

  const playBtn = el('button', { class: 'btn', type: 'button', id: 'pv-play', 'aria-label': 'Play', text: '▶', onclick: () => (playing ? pause() : play()) });
  const prevBtn = el('button', { class: 'btn', type: 'button', id: 'pv-prev', 'aria-label': 'Previous frame', text: '◀|', onclick: () => step(-1) });
  const nextBtn = el('button', { class: 'btn', type: 'button', id: 'pv-next', 'aria-label': 'Next frame', text: '|▶', onclick: () => step(1) });
  const loopBtn = el('button', { class: 'btn', type: 'button', id: 'pv-loop', 'aria-pressed': 'false', 'aria-label': 'Loop', text: 'Loop', onclick: () => { loop = !loop; loopBtn.setAttribute('aria-pressed', String(loop)); } });
  const muteBtn = el('button', { class: 'btn', type: 'button', id: 'pv-mute', 'aria-pressed': 'false', 'aria-label': 'Mute', text: 'Mute', onclick: () => {
    muted = !muted;
    muteBtn.setAttribute('aria-pressed', String(muted));
    if (audio) audio.muted = muted;
  } });
  const readout = el('span', { class: 'pv-readout', id: 'pv-readout', 'aria-live': 'off', text: 'frame 0 / 0' });
  const slider = el('input', { type: 'range', id: 'pv-slider', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Scrub, frame accurate', disabled: true,
    oninput: () => seekFrame(Number(slider.value)) });
  const ticks = el('div', { class: 'pv-ticks', 'aria-hidden': 'true' });
  const scrub = el('div', { class: 'pv-scrub' }, slider, ticks);
  const controls = el('div', { class: 'pv-controls' }, playBtn, prevBtn, nextBtn, loopBtn, muteBtn, readout, scrub);

  const wordBtns = words.map((w) => el('button', { class: 'w', type: 'button', 'data-id': w.id, text: w.text, onclick: () => { pause(); seekTime((w.f0 - beat.f0) / fps); } }));
  const wordStrip = el('div', { class: 'pv-words', id: 'pv-words', role: 'group', 'aria-label': 'Words: click to seek' }, wordBtns);
  if (!words.length) wordStrip.hidden = true;

  const root = el('section', { class: 'pv', 'aria-label': 'Preview player' }, stage, errBox, controls, audioNote, wordStrip);
  setControlsEnabled(false);

  // ---- messaging with the sandboxed frame
  const post = (m) => { if (frame.contentWindow) frame.contentWindow.postMessage(m, '*'); };
  function onMessage(e) {
    if (e.source !== frame.contentWindow) return; // origin is opaque ("null"), so identify the sender by window
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'ready') {
      ready = true;
      clearTimeout(timer);
      sendLoad();
    } else if (d.type === 'loaded') {
      clearTimeout(timer);
      onLoaded(d);
    } else if (d.type === 'error') {
      errCount++;
      showError(d.message, d.t);
      if (!loadedOnce) setState('error', 'The preview could not start.');
    }
  }
  addEventListener('message', onMessage);

  function sendLoad() {
    if (!bundle || !ready) return;
    setState(loadedOnce ? 'ready' : 'loading', 'Loading preview...');
    post({ type: 'load', bundle });
    clearTimeout(timer);
    timer = setTimeout(() => { if (!destroyed && stage.dataset.state === 'loading') setState('error', 'The preview timed out while loading.'); }, LOAD_TIMEOUT_MS);
  }
  timer = setTimeout(() => { if (!ready && !destroyed) setState('error', 'The preview frame did not start. Reload the page.'); }, READY_TIMEOUT_MS);

  function setState(s, text) {
    stage.dataset.state = s;
    msg.hidden = s === 'ready';
    if (text) msg.textContent = text;
  }

  function showError(message, t) {
    errBox.hidden = false;
    errBox.textContent = 'Scene error' + (t != null ? ' at ' + fmtClock(t, fps) + ' (' + t.toFixed(2) + 's)' : '') + ': ' + message;
    errBox.dataset.t = t == null ? '' : String(t);
  }

  function onLoaded(d) {
    fps = d.fps > 0 ? d.fps : fps;
    frames = Math.max(1, d.frames | 0);
    dur = d.dur > 0 ? d.dur : frames / fps;
    slider.max = frames - 1;
    slider.disabled = false;
    drawTicks(d.markers || []);
    setControlsEnabled(true);
    setState('ready');
    errBox.hidden = true;
    const keep = loadedOnce ? curN : 0;
    loadedOnce = true;
    sentN = -1;
    seekFrame(Math.min(keep, frames - 1), true);
  }

  function drawTicks(markers) {
    ticks.replaceChildren(...markers.filter((m) => m.t >= 0 && m.t <= dur).map((m) => {
      const tk = el('span', { class: 'pv-tick ' + m.kind, title: m.kind + ' @ ' + m.t.toFixed(2) + 's', 'data-kind': m.kind, 'data-id': m.id });
      tk.style.left = (dur ? (m.t / dur) * 100 : 0) + '%';
      return tk;
    }));
  }

  function setControlsEnabled(on) {
    for (const b of [playBtn, prevBtn, nextBtn]) b.disabled = !on;
  }

  // ---- audio
  function setupAudio() {
    teardownAudio();
    useAudio = false;
    audioNote.hidden = true;
    if (!bundle || !bundle.wav_url) return;
    audio = new Audio();
    audio.preload = 'auto';
    audio.muted = muted;
    audio.addEventListener('error', () => { useAudio = false; showAudioNote('Sound could not be loaded; playing silently.'); });
    audio.addEventListener('loadedmetadata', () => {
      // Range support is required for seeking (verified by experiment): without it seekable ends at 0.
      useAudio = audio.seekable.length > 0 && audio.seekable.end(0) > 0;
      if (!useAudio) showAudioNote('The server does not support byte ranges, so sound cannot seek; playing silently.');
    });
    audio.src = bundle.wav_url;
  }
  function showAudioNote(t) { audioNote.hidden = false; audioNote.textContent = t; }
  function teardownAudio() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load(); // releases the network resource and decoder
    audio = null;
  }

  // ---- time
  const clamp = (n) => Math.min(Math.max(0, n), Math.max(0, frames - 1));
  function show(n, force) {
    n = clamp(n);
    curN = n;
    if (n !== sentN || force) {
      sentN = n;
      const q = quantise(n / fps, fps, frames);
      post({ type: 'seek', t: q.t });
      scheduleErrorClear();
    }
    if (Number(slider.value) !== n) slider.value = n;
    const t = n / fps;
    readout.textContent = 'frame ' + n + ' / ' + frames + ' · ' + fmtClock(t, fps);
    readout.dataset.frame = String(n);
    highlightWord(n);
  }

  // The frame only reports failures, so a stale error box clears when the latest seek produced no new error.
  let errClearTimer = 0;
  function scheduleErrorClear() {
    if (errBox.hidden) return;
    const mark = errCount;
    clearTimeout(errClearTimer);
    errClearTimer = setTimeout(() => { if (errCount === mark) errBox.hidden = true; }, 150);
  }

  function highlightWord(n) {
    if (!words.length) return;
    let idx = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].f0 - beat.f0 <= n) idx = i;
      else break;
    }
    if (idx === wordIdx) return;
    if (wordIdx >= 0 && wordBtns[wordIdx]) wordBtns[wordIdx].classList.remove('cur');
    wordIdx = idx;
    if (idx >= 0) {
      const b = wordBtns[idx];
      b.classList.add('cur');
      if (playing) {
        const top = b.offsetTop - wordStrip.offsetTop;
        if (top < wordStrip.scrollTop || top + b.offsetHeight > wordStrip.scrollTop + wordStrip.clientHeight) wordStrip.scrollTop = Math.max(0, top - 8);
      }
    }
  }

  function seekFrame(n, force) {
    n = clamp(n);
    show(n, force);
    const t = n / fps;
    if (audio && useAudio && Math.abs(audio.currentTime - t) > 0.02) audio.currentTime = t;
    if (playing) { t0perf = performance.now(); t0 = t; }
  }
  const seekTime = (t) => seekFrame(Math.round(t * fps));
  function step(d) {
    pause();
    seekFrame(curN + d);
  }

  function clockNow() {
    return useAudio && audio && !audio.paused ? audio.currentTime : t0 + (performance.now() - t0perf) / 1000;
  }
  function tick() {
    if (!playing) return;
    const t = clockNow();
    if (t >= dur - 0.5 / fps) {
      if (loop) {
        seekFrame(0);
        if (audio && useAudio) audio.play().catch(() => {});
      } else {
        show(frames - 1);
        pause();
        return;
      }
    } else show(Math.round(t * fps));
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (!loadedOnce) return;
    if (curN >= frames - 1) seekFrame(0);
    playing = true;
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause');
    playBtn.dataset.playing = 'true';
    t0 = curN / fps;
    t0perf = performance.now();
    stage.dataset.clock = audio && useAudio ? 'audio' : 'timer';
    if (audio && useAudio) {
      audio.currentTime = t0;
      audio.play().catch(() => showAudioNote('The browser blocked sound; tap play again.'));
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    if (audio) audio.pause();
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.dataset.playing = 'false';
  }
  const onVis = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', onVis);

  // ---- API
  function setBundle(b) {
    const audioChanged = !bundle || bundle.wav_url !== b.wav_url;
    bundle = b;
    fps = b.fps || fps;
    if (b.width && b.height) stage.style.aspectRatio = b.width + ' / ' + b.height;
    if (audioChanged) { pause(); setupAudio(); }
    sendLoad(); // also reloads the scene inside the same frame when a new version was selected
  }

  return {
    el: root,
    setBundle,
    /** current frame index, for tests and the beat page */
    frame: () => curN,
    pause,
    destroy() {
      destroyed = true;
      pause();
      clearTimeout(timer);
      clearTimeout(errClearTimer);
      removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVis);
      teardownAudio();
      frame.src = 'about:blank';
      frame.remove();
    },
  };
}
