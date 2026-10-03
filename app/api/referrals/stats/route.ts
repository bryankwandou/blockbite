/**
 * GET /api/referrals/stats
 *   → { total, referrers, top: [{ wallet (shortened), count }] }  (top 10)
 * Public totals for the leaderboard page. Cached 60 s at the edge.
 */
import { publicStats, referralsConfigured } from '@/lib/referrals/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!referralsConfigured()) return NextResponse.json({ error: 'referrals are not available' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    return NextResponse.json(await publicStats(), { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (e) {
    console.error('referral stats', e);
    return NextResponse.json({ error: 'referrals are not available' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
