import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { resolveDraftFile } from '../../../../../lib/drafts';

export const dynamic = 'force-dynamic';

function contentTypeFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export async function GET(request, context) {
  const { slug, file } = await context.params;
  const found = resolveDraftFile(slug, file);
  if (!found) {
    return new Response('Not found', { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const download = searchParams.get('download') === '1';
  const type = contentTypeFor(file);
  const range = request.headers.get('range');
  const baseHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };

  if (download) {
    baseHeaders['Content-Disposition'] = `attachment; filename="${file}"`;
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      return new Response('Invalid range', {
        status: 416,
        headers: { 'Content-Range': `bytes */${found.size}` },
      });
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : found.size - 1;

    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, found.size - suffix);
      end = found.size - 1;
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= found.size) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${found.size}` },
      });
    }

    const chunkSize = end - start + 1;
    const stream = createReadStream(found.path, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${found.size}`,
        'Content-Length': String(chunkSize),
      },
    });
  }

  const stream = createReadStream(found.path);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(found.size),
    },
  });
}
