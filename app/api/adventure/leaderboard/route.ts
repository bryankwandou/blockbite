/**
 * GET /api/adventure/leaderboard[?wallet=<addr>]
 * Free-mode board: wallets by level reached, then best score. No prizes.
 * rows: [{ wallet, level, score, avatarId }]; me: { rank, level, score } | null
 */
import { adventureBoard, adventureConfigured, adventureRank } from '@/lib/adventure/db';
import { isWallet } from '@/lib/ranked/auth';
import { fail } from '@/lib/ranked/http';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!adventureConfigured()) return fail(503, 'leaderboard is not available');
  const wallet = new URL(req.url).searchParams.get('wallet');
  try {
    const [rows, me] = await Promise.all([
      adventureBoard(50),
      wallet && isWallet(wallet) ? adventureRank(wallet) : Promise.resolve(null),
    ]);
    return NextResponse.json({ period: 'adventure', rows, me }, {
      headers: { 'Cache-Control': wallet ? 'no-store' : 'public, s-maxage=15, stale-while-revalidate=60' },
    });
  } catch (e) {
    console.error('adventure board', e);
    return fail(503, 'leaderboard is not available');
  }
}
