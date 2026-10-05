import { NextRequest, NextResponse } from 'next/server';
import { neonTrackWallet } from '@/lib/neon-analytics';

import { getIP, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`wallet-connect:${getIP(req)}`, 30, 10 * 60_000).catch(() => null);
  if (rl && !rl.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  try {
    const body = await req.json().catch(() => ({}));
    const anon       = typeof body?.anon       === 'string' ? body.anon.slice(0, 20)       : 'unknown';
    const walletName = typeof body?.walletName === 'string' ? body.walletName.slice(0, 40) : 'unknown';
    const path       = body?.path;
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 200) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // Fire-and-forget — don't block response
    // Log failures so silent Neon write errors can be audited in Vercel logs
    neonTrackWallet(anon, walletName, path).catch((err) => {
      console.error('[wallet-connect] Neon write failed:', err);
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
