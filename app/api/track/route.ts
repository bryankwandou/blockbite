import { NextRequest, NextResponse } from 'next/server';
import { neonTrackView } from '@/lib/neon-analytics';

import { readJson } from '@/lib/http/body';
import { getIP, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`track:${getIP(req)}`, 300, 10 * 60_000).catch(() => null);
  if (rl && !rl.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  try {
    const body = await readJson(req, 2048);
    if (body instanceof Response) return NextResponse.json({ ok: false }, { status: body.status });
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
