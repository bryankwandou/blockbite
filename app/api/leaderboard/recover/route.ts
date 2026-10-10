/**
 * POST /api/leaderboard/recover
 *
 * One-shot data recovery: migrates all scores from the legacy
 * `blockbite:leaderboard` KV hash (and `bb:lb:meta`) into the
 * period sorted sets that the live leaderboard reads from.
 *
 * Why this exists:
 *   A zadd signature bug in @vercel/kv v3 (fixed in commit c2d7c91) caused
 *   all scores submitted before the fix to land only in the legacy hash,
 *   not in the sorted sets. This endpoint replays every stored entry back
 *   through the sorted-set layer without downgrading any existing score
 *   (uses the GT flag).
 *
 * Auth: ADMIN_SECRET (>= 16 chars) as `Authorization: Bearer <secret>`.
 * Query-string secrets are rejected (they end up in logs and history).
 * Safe to call multiple times — idempotent via GT flag.
 */

import { NextRequest, NextResponse } from 'next/server';
import { recoverLegacyData } from '@/lib/leaderboard/store';
import { getIP, rateLimit } from '@/lib/rate-limit';
import { safeEqual } from '@/lib/safeEqual';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.has('secret')) {
    return NextResponse.json({ error: 'Send the secret as an Authorization: Bearer header, not in the URL' }, { status: 400 });
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || adminSecret.length < 16) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rl = await rateLimit(`recover:${getIP(req)}`, 10, 15 * 60_000).catch(() => null);
  if (rl && !rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429, headers: { 'Retry-After': '900' } });
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m || !safeEqual(m[1], adminSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await recoverLegacyData();

  return NextResponse.json({
    ok: true,
    ...result,
    message: `Recovered ${result.wallets} wallets into sorted sets. Errors: ${result.errors}.`,
  });
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST with Authorization: Bearer' }, { status: 405, headers: { Allow: 'POST' } });
}
