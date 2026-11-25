const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const SAFE_SEG = /^[a-z0-9][a-z0-9._-]*$/i;

export function isSafeVideoPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('..')) {
    return false;
  }
  if (value.startsWith('/') || value.endsWith('/')) return false;
  if (!VIDEO_EXT.test(value)) return false;
  const segments = value.split('/');
  return segments.length >= 1 && segments.length <= 4 && segments.every((seg) => SAFE_SEG.test(seg));
}

export function titleFromSlug(slug) {
  const words = String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Untitled session';
  return words.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function isWideName(name) {
  return /(^|[/_-])16x9([/_.-]|$)/i.test(String(name || ''));
}

function extractFolderSlug(name) {
  const normalized = String(name || '').replace(/^\/+/, '');
  if (normalized.includes('/')) {
    const top = normalized.split('/')[0].trim();
    if (top) return top.toLowerCase();
  }

  const file = normalized.split('/').pop() || '';
  let stem = file.replace(/\.[^.]+$/, '');
  while (true) {
    const next = stem
      .replace(/(?:[-_](?:part|pt)[-_]?\d+)$/i, '')
      .replace(/(?:[-_]16x9)$/i, '');
    if (next === stem || !next) break;
    stem = next;
  }
  return stem.toLowerCase() || 'untitled';
}

function extractPartOrder(name) {
  const stem = String(name || '')
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '');
  const nums = [];
  const re = /(?:^|[-_])(?:part|pt)[-_]?(\d+)/gi;
  let match;
  while ((match = re.exec(stem)) !== null) {
    nums.push(Number(match[1]));
  }
  return nums;
}

export function parseVideoEntry(item) {
  const name = String(item?.name || '');
  const filename = name.split('/').pop() || name;
  const wide = isWideName(name);
  const aspect = wide ? '16:9' : '9:16';
  const folderSlug = extractFolderSlug(name);
  const folderTitle = titleFromSlug(folderSlug);
  const partOrder = extractPartOrder(name);

  let partLabel;
  if (partOrder.length === 1) {
    partLabel = `Part ${partOrder[0]}`;
  } else if (partOrder.length > 1) {
    partLabel = `Part ${partOrder.join('.')}`;
  } else if (name.includes('/')) {
    const cleanStem = filename.replace(/\.[^.]+$/, '').replace(/(^|[-_])16x9(?=[-_]|$)/gi, '');
    partLabel = titleFromSlug(cleanStem) || 'Full clip';
  } else {
    partLabel = wide ? 'Landscape clip' : 'Full clip';
  }

  const title = filename
    .replace(/\.[^.]+$/, '')
    .replace(/(^|[-_])16x9(?=[-_]|$)/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  return {
    name,
    filename,
    title: titleFromSlug(title || filename),
    partLabel,
    partOrder,
    folderSlug,
    folderTitle,
    wide,
    aspect,
    size: typeof item?.size === 'number' ? item.size : null,
    created: item?.created ?? null,
    src: item?.src ?? '',
    download: item?.download ?? '',
  };
}

export function comparePartOrder(a, b) {
  const ao = a.partOrder || [];
  const bo = b.partOrder || [];
  const maxLen = Math.max(ao.length, bo.length);

  if (ao.length > 0 && bo.length > 0) {
    for (let i = 0; i < maxLen; i++) {
      const av = ao[i];
      const bv = bo[i];
      if (av === undefined && bv !== undefined) return -1;
      if (av !== undefined && bv === undefined) return 1;
      if (av !== bv) return av - bv;
    }
  } else if (ao.length !== bo.length) {
    return ao.length > 0 ? -1 : 1;
  }

  const at = a.created ? Date.parse(a.created) : 0;
  const bt = b.created ? Date.parse(b.created) : 0;
  if (at && bt && at !== bt) return at - bt;

  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function groupVideosIntoFolders(rawVideos) {
  const map = new Map();

  for (const raw of rawVideos || []) {
    const video = raw?.folderSlug ? raw : parseVideoEntry(raw);
    let folder = map.get(video.folderSlug);
    if (!folder) {
      folder = {
        slug: video.folderSlug,
        title: video.folderTitle,
        videos: [],
        totalBytes: 0,
        latestCreated: null,
        latestMs: 0,
        aspects: [],
      };
      map.set(video.folderSlug, folder);
    }

    folder.videos.push(video);
    if (typeof video.size === 'number' && Number.isFinite(video.size)) {
      folder.totalBytes += video.size;
    }
    if (video.created) {
      const ms = Date.parse(video.created);
      if (Number.isFinite(ms) && ms > folder.latestMs) {
        folder.latestMs = ms;
        folder.latestCreated = video.created;
      }
    }
    if (!folder.aspects.includes(video.aspect)) {
      folder.aspects.push(video.aspect);
    }
  }

  const folders = Array.from(map.values()).map((folder) => {
    folder.videos.sort(comparePartOrder);
    return {
      slug: folder.slug,
      title: folder.title,
      clipCount: folder.videos.length,
      totalBytes: folder.totalBytes,
      latestCreated: folder.latestCreated,
      latestMs: folder.latestMs,
      aspects: folder.aspects,
      videos: folder.videos,
    };
  });

  folders.sort((a, b) => {
    if (b.latestMs !== a.latestMs) return b.latestMs - a.latestMs;
    return a.title.localeCompare(b.title);
  });

  return folders;
}
