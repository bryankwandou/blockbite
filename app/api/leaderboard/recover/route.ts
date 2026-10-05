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
 * Auth: ADMIN_SECRET via ?secret=, x-admin-secret, or Authorization: Bearer.
 * Safe to call multiple times — idempotent via GT flag.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { recoverLegacyData } from '@/lib/leaderboard/store';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  const secret = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('x-admin-secret') ?? bearer;

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || !secret || !safeEqual(secret, adminSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await recoverLegacyData();

  return NextResponse.json({
    ok: true,
    ...result,
    message: `Recovered ${result.wallets} wallets into sorted sets. Errors: ${result.errors}.`,
  });
}

// Also allow GET for easy browser-triggered recovery (same auth required)
export async function GET(req: NextRequest) {
  return POST(req);
}
