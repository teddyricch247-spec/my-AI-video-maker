export const STATUS = {
  approved: ['Approved', 'ok'],
  review: ['Ready to review', 'pri'],
  running: ['Building', 'warn'],
  queued: ['Waiting', 'gray'],
  attention: ['Needs attention', 'warn'],
  failed: ['Failed', 'bad'],
};

export const TITLES = ['Cold open', 'Why orbits curve', 'The slingshot', 'Swap every word', 'Numbers on screen', 'Three misconceptions', 'The comparison', 'Closing line'];
export const LENGTHS = [3.2, 5.1, 4.0, 4.4, 6.2, 7.5, 5.8, 3.6];

export const projects = [
  { id: 'orbit', name: 'Orbit Explainer', words: 412, spent: 0.41, when: '12 min ago', beats: ['approved', 'approved', 'approved', 'review', 'running', 'queued', 'queued', 'queued'] },
  { id: 'launch', name: 'Product Launch', words: 268, spent: 0.29, when: '2 hours ago', beats: ['approved', 'approved', 'attention', 'failed', 'queued', 'queued'] },
  { id: 'podcast', name: 'Podcast Clip', words: 190, spent: 0.12, when: 'Yesterday', beats: ['review', 'review', 'approved', 'approved'] },
  { id: 'wedding', name: 'Wedding Speech', words: 530, spent: 0.55, when: '3 days ago', beats: ['approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved'] },
];

export const getProject = (id) => projects.find((p) => p.id === id);
export const titleOf = (i) => TITLES[i % TITLES.length];
export const lengthOf = (i) => LENGTHS[i % LENGTHS.length];

export const counts = (beats) => ({
  approved: beats.filter((b) => b === 'approved').length,
  review: beats.filter((b) => b === 'review' || b === 'attention' || b === 'failed').length,
  running: beats.filter((b) => b === 'running').length,
});

export const LINE = [
  ['Every', 0], ['word', 0.5], ['you', 0.9], ['swap', 1.2], ['changes', 1.9],
  ['how', 2.4], ['the', 2.7], ['sentence', 2.95], ['lands.', 3.6],
];
export const MARKS = [[1.2, 'Whoosh on “swap”'], [3.6, 'Pop on “lands”']];
export const DUR = 4.4;
