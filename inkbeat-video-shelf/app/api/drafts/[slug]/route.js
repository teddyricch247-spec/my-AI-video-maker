import { NextResponse } from 'next/server';
import { discardDraft, publishDraft } from '../../../../lib/drafts';

export const dynamic = 'force-dynamic';

export async function POST(request, context) {
  const { slug } = await context.params;
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await publishDraft(slug, body?.name);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, status: result.status },
      { status: result.status >= 400 ? result.status : 500 }
    );
  }
  return NextResponse.json(result);
}

export async function DELETE(_request, context) {
  const { slug } = await context.params;
  const result = discardDraft(slug);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status || 400 });
  }
  return NextResponse.json({ ok: true });
}
