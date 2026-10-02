/**
 * GET /api/leaderboard?limit=20&period=monthly|daily|all
 *
 * Double-database leaderboard:
 *   - Reads from KV sorted sets (period-partitioned) for fast, accurate results
 *   - Falls back to legacy hash on empty sorted sets (recovery path)
 *   - Falls back to in-memory Map on cold start / KV unavailable
 *   - period param drives Monthly / Daily / All-Time tabs on the frontend
 */

import { NextRequest, NextResponse } from 'next/server';
import { LEADERBOARD, hydrateFromKV, getTopScores } from '@/lib/leaderboard/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const limit  = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
  const period = (url.searchParams.get('period') ?? 'all') as 'all' | 'monthly' | 'daily';

  // Warm the in-memory cache from KV on cold start
  await hydrateFromKV();

  // Read from time-partitioned sorted sets (with fallback to legacy hash)
  const entries = await getTopScores(period, limit);

  const live = entries.map((e, i) => ({
    rank:          i + 1,
    wallet:        e.walletAddress.slice(0, 4) + '...' + e.walletAddress.slice(-4),
    walletAddress: e.walletAddress,
    score:         e.score,
    level:         e.level,
    submittedAt:   e.submittedAt,
    txSignature:   e.txSignature ?? null,
    ticketsUsed:   e.ticketsUsed ?? null,
    live:          true,
  }));

  return NextResponse.json({
    entries: live,
    total:   LEADERBOARD.size,
    period,
  });
}
