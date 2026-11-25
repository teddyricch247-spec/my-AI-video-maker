import { NextResponse } from 'next/server';
import { deleteVideos, listVideos } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await listVideos();
  if (result.problem) {
    return NextResponse.json(
      { ok: false, problem: result.problem, bucket: result.bucket, status: result.status },
      { status: result.status || 502 }
    );
  }
  return NextResponse.json(
    { ok: true, folders: result.folders, videos: result.videos },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function DELETE(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const names = Array.isArray(body?.names)
    ? body.names
    : typeof body?.name === 'string'
      ? [body.name]
      : [];

  const result = await deleteVideos(names);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || 'Delete failed.' },
      { status: result.status >= 400 ? result.status : 500 }
    );
  }

  return NextResponse.json({ ok: true, deleted: result.deleted });
}
