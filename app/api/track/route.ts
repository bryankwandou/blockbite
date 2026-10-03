import { NextRequest, NextResponse } from 'next/server';
import { neonTrackView } from '@/lib/neon-analytics';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawPath = body?.path;
    if (typeof rawPath !== 'string' || !rawPath.startsWith('/') || rawPath.length > 200) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const path = rawPath;
    const sid  = typeof body?.sid  === 'string' ? body.sid.slice(0, 64)   : 'anon';

    // Fire-and-forget — don't block the response
    neonTrackView(path, sid).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
