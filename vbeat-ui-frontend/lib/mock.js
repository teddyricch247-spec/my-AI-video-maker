// Prototype-only data for the project flow pages (new project, setup, plan, export).
// Nothing here talks to a backend. Shapes follow the Sprite's API contract so wiring
// later is a swap, not a rewrite.
import { getProject, titleOf, lengthOf, LINE, MARKS, DUR } from './data';

/* ---------- projects ---------- */

// Any id that is not in data.js is treated as a fresh draft, so "Create project" can land somewhere.
export const draftProject = (id) => ({ id, name: 'New project', words: 0, spent: 0, when: 'Just now', beats: [] });
export const projectOr = (id) => getProject(id) ?? draftProject(id);

/* ---------- new project ---------- */

export const FPS = [24, 25, 30, 60];
export const SIZES = [
  ['1280x720', '720p', '1280 × 720'],
  ['1920x1080', '1080p', '1920 × 1080'],
  ['2560x1440', '1440p', '2560 × 1440'],
  ['3840x2160', '4K', '3840 × 2160'],
];

/* ---------- setup ---------- */

export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const READING = {
  cues: 58,
  first: [
    { at: '0:00.0 to 0:03.2', text: 'Every planet you have ever seen is falling.' },
    { at: '0:03.2 to 0:08.3', text: 'It just keeps missing the ground.' },
    { at: '0:08.3 to 0:12.3', text: 'That is all an orbit is.' },
  ],
  last: [
    { at: '2:29.0 to 2:33.4', text: 'So the next time you look up,' },
    { at: '2:33.4 to 2:38.0', text: 'remember what you are watching.' },
    { at: '2:38.0 to 2:41.0', text: 'Things falling, beautifully.' },
  ],
};

export const IMAGES = [
  { id: 'i1', name: 'orbit-diagram.png', size: '184 KB', hue: 255 },
  { id: 'i2', name: 'earth-from-space.jpg', size: '1.2 MB', hue: 200 },
  { id: 'i3', name: 'slingshot-path.svg', size: '12 KB', hue: 320 },
];

/* ---------- plan ---------- */

const MODES = ['story', 'technical', 'technical', 'story', 'technical', 'story', 'technical', 'story'];
const DIRECTIONS = [
  'Open on a black frame. One line of text fades in, then the title lands.',
  'Draw an orbit as a curve that bends toward a planet. Label the pull and the sideways speed.',
  'Show a probe swinging past a planet and leaving faster than it arrived.',
  'Swap the words one at a time. Keep the layout fixed so only the meaning moves.',
  'Put the numbers on screen as they are spoken. Count up, then settle.',
  'Three cards, one per misconception, each crossed out in turn.',
  'Two columns side by side. Highlight the difference as it is mentioned.',
  'Hold on the last line. Fade the picture, keep the words.',
];
const TEXTS = [
  'Every planet you have ever seen is falling. It just keeps missing the ground.',
  'An orbit is a fall that never lands. Speed sideways, pull downward, and the two stay in balance.',
  'A spacecraft can borrow energy from a planet. It flies close, swings round, and leaves faster than it arrived.',
  'Every word you swap changes how the sentence lands.',
  'At 28,000 kilometres an hour, the station circles the Earth every 90 minutes.',
  'People think there is no gravity up there. There is. People think the Moon is far. It is. People think orbits are perfect circles. They are not.',
  'Compare a low orbit with a high one. The lower you go, the faster you must move.',
  'So the next time you look up, remember what you are watching. Things falling, beautifully.',
];

const tc = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

// beats = array of beat statuses (same as data.js). An empty array falls back to an 8 beat demo plan.
export function planFor(beats) {
  const n = beats.length || 8;
  let t = 0;
  return Array.from({ length: n }, (_, i) => {
    const dur = lengthOf(i);
    const row = {
      n: i + 1,
      title: titleOf(i),
      mode: MODES[i % MODES.length],
      direction: DIRECTIONS[i % DIRECTIONS.length],
      text: TEXTS[i % TEXTS.length],
      start: tc(t),
      dur,
    };
    t += dur;
    return row;
  });
}

export const BIBLE = [
  ['Look', 'Dark indigo background, one accent colour, lots of empty space.'],
  ['Type', 'A heavy geometric sans for headlines. Each word is highlighted as it is spoken.'],
  ['Motion', 'Slow, eased moves. Nothing bounces. Cuts land on the rhythm of the narration.'],
  ['Sound', 'Soft whooshes on movement and one pop on the last word of each beat.'],
];

export const VALIDATION = [
  'Beat 5 runs 0.4 seconds into beat 6.',
  'Three words from the transcript are missing between beats 3 and 4.',
];

export const CHAT = [
  {
    id: 1,
    role: 'dir',
    text: 'I read your transcript and split it into 8 beats. Beats 2, 3, 5 and 7 need diagrams, so I marked them technical. The rest are story beats.',
    steps: ['Read the transcript', 'Planned 8 beats', 'Checked the timings'],
  },
  { id: 2, role: 'user', text: 'Make the cold open shorter, and keep the numbers beat technical.' },
  {
    id: 3,
    role: 'dir',
    text: 'Done. The cold open is now 3.2 seconds, down from 5.0, and the numbers beat stays technical. I moved the spare 1.8 seconds into the slingshot.',
    steps: ['Edited beat 1', 'Edited beat 3', 'Checked the timings'],
  },
  { id: 4, role: 'user', text: 'Can the closing line land right on the last word?', queued: true },
];

export const QUICK = ['Shorter beats', 'Merge beats 2 and 3', 'More playful', 'Keep it technical'];

/* ---------- export ---------- */

const MB = [2.4, 3.8, 3.1, 3.5, 4.9, 6.0, 4.6, 2.8];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A beat can be exported once it has a scene (approved, or waiting for review).
export const exportable = (s) => s === 'approved' || s === 'review' || s === 'attention';
export const fileName = (i) => `beat-${String(i + 1).padStart(2, '0')}-${slug(titleOf(i))}.mp4`;
export const fileMb = (i) => MB[i % MB.length];
export const fileSize = (i) => `${fileMb(i).toFixed(1)} MB`;

export function exportsFor(beats) {
  const ok = beats.flatMap((s, i) => (s === 'approved' ? [i] : []));
  if (!ok.length) return [];
  return [
    { id: 'e3', status: 'running', when: 'Just now', progress: [1, ok.length], files: [] },
    { id: 'e2', status: 'done', when: 'Yesterday, 18:04', expires: 'in 6 days', files: ok },
    { id: 'e1', status: 'expired', when: '3 weeks ago', files: ok.slice(0, 2) },
  ];
}

/* ---------- home ---------- */

// The one status a project card should flag, most urgent first.
const URGENT = ['failed', 'attention', 'review', 'running'];
export const flagOf = (beats) => URGENT.find((s) => beats.includes(s)) ?? null;
export const needsYou = (beats) => ['failed', 'attention', 'review'].includes(flagOf(beats));
export const byUrgency = (a, b) => {
  const r = (p) => { const k = URGENT.indexOf(flagOf(p.beats)); return k < 0 ? 9 : k; };
  return r(a) - r(b);
};

/* ---------- beat review: what each beat shows on screen ---------- */

const SCREEN = [
  'Every planet is falling.',
  'An orbit is a fall that never lands.',
  'Borrow speed from a planet.',
  null, // beat 4 keeps the original sample line from data.js
  '28,000 km/h. Every 90 minutes.',
  'Three things people get wrong.',
  'The lower you go, the faster you move.',
  'Things falling, beautifully.',
];
const bare = (w) => w.replace(/[.,!?]/g, '');

export function sceneFor(i) {
  const k = i % SCREEN.length;
  if (SCREEN[k] === null) return { line: LINE, marks: MARKS, dur: DUR };
  const dur = lengthOf(i);
  const words = SCREEN[k].split(' ');
  const line = words.map((w, j) => [w, +((j / words.length) * dur * 0.9).toFixed(2)]);
  const marks = [
    [line[1][1], `Whoosh on “${bare(words[1])}”`],
    [line[line.length - 1][1], `Pop on “${bare(words[words.length - 1])}”`],
  ];
  return { line, marks, dur };
}

/* ---------- settings (sample data, same shapes as the API contract) ---------- */

export const MODELS = [
  { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet', supports_tools: true, supports_images: true, price_in: 3, price_out: 15 },
  { id: 'anthropic/claude-haiku', name: 'Claude Haiku', supports_tools: true, supports_images: true, price_in: 1, price_out: 5 },
  { id: 'google/gemini-flash', name: 'Gemini Flash', supports_tools: true, supports_images: true, price_in: 0.3, price_out: 2.5 },
  { id: 'openai/gpt-mini', name: 'GPT Mini', supports_tools: true, supports_images: true, price_in: 0.4, price_out: 1.6 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', supports_tools: true, supports_images: false, price_in: 0.28, price_out: 0.42 },
  { id: 'meta/llama-70b', name: 'Llama 70B', supports_tools: false, supports_images: false, price_in: 0.6, price_out: 0.6 },
];

export const SETTINGS = {
  models: { director: 'anthropic/claude-sonnet', beat: 'google/gemini-flash' },
  caps: { run_usd: 5, daily_usd: 20, beat_usd: 0.5, director_usd: 1, max_steps: 40, max_minutes: 15 },
  beat_concurrency: 3,
  sfx_peak_dbfs: -3,
  kill_switch: false,
  spend_today_usd: 0.18,
};

// [key, label, min, step, unit]
export const CAP_FIELDS = [
  ['run_usd', 'Max spend per run', 0, 0.5, 'USD'],
  ['daily_usd', 'Max spend per day', 0, 0.5, 'USD'],
  ['beat_usd', 'Max spend per beat', 0, 0.1, 'USD'],
  ['director_usd', 'Max spend for planning', 0, 0.1, 'USD'],
  ['max_steps', 'Max steps per beat', 1, 1, 'steps'],
  ['max_minutes', 'Max minutes per beat', 1, 1, 'min'],
];

/* ---------- ops ---------- */

export const OPS = {
  ok: {
    problems: [],
    planner: { id: 'planner-1', up: '6 h 52 min', version: '0.14.2', reconcile: '2 min ago' },
    storage: { summary: '3.2 GB of 10 GB used', percent: 32, buckets: ['Renders 2.1 GB', 'Scenes 0.8 GB', 'Uploads 0.3 GB'] },
    workers: [
      { id: 'worker-1', seen: '12 s ago', running: 1, slots: 3, state: 'ok', label: 'Online' },
      { id: 'worker-2', seen: '18 s ago', running: 0, slots: 3, state: 'ok', label: 'Online' },
    ],
    queue: '1 beat running, 2 beats waiting.',
    errors: [],
    checks: [
      { name: 'Database', ok: true, detail: 'Reachable in 12 ms.' },
      { name: 'Storage', ok: true, detail: 'Read and write both work.' },
      { name: 'Keys', ok: true, detail: 'Model and storage keys are set.' },
      { name: 'Model list', ok: true, detail: '6 models loaded.' },
      { name: 'Worker worker-1', ok: true, detail: 'Awake, 2 free slots.' },
      { name: 'Worker worker-2', ok: true, detail: 'Awake, 3 free slots.' },
    ],
    test: { ok: true, message: 'Self-test passed. One real beat was built end to end.', meta: 'Status done · 6 steps · $0.02 · 41 s · job #118 done' },
  },
  bad: {
    problems: ['Worker worker-3 has not checked in for 14 minutes.', 'Storage is 91% full. Exports may fail.'],
    planner: { id: 'planner-1', up: '6 h 52 min', version: '0.14.2', reconcile: '2 min ago' },
    storage: { summary: '9.1 GB of 10 GB used', percent: 91, buckets: ['Renders 7.4 GB', 'Scenes 1.2 GB', 'Uploads 0.5 GB'] },
    workers: [
      { id: 'worker-1', seen: '12 s ago', running: 1, slots: 3, state: 'ok', label: 'Online' },
      { id: 'worker-2', seen: '18 s ago', running: 0, slots: 3, state: 'warn', label: 'Online, not taking jobs: out of disk' },
      { id: 'worker-3', seen: '14 min ago', running: 0, slots: 3, state: 'bad', label: 'Offline' },
    ],
    queue: '3 beats waiting. Nothing is running.',
    errors: [{ id: 212, kind: 'beat', error: 'Model call timed out after 120 s' }],
    checks: [
      { name: 'Database', ok: true, detail: 'Reachable in 14 ms.' },
      { name: 'Storage', ok: false, detail: '91% full.', fix: 'Delete old exports in a project, or raise the storage limit.' },
      { name: 'Keys', ok: true, detail: 'Model and storage keys are set.' },
      { name: 'Model list', ok: true, detail: '6 models loaded.' },
      { name: 'Worker worker-1', ok: true, detail: 'Awake, 2 free slots.' },
      { name: 'Worker worker-3', ok: false, detail: 'No answer after 60 s.', fix: 'Press Wake workers, then check again. If it stays offline, restart it.' },
    ],
    test: { ok: false, message: 'Self-test failed. No worker took the job within 60 seconds.', meta: 'Status failed · 2 steps · $0.00 · 60 s · job #119 queued' },
  },
};
