/**
 * GET /api/referrals?wallet=<address>
 *   → { wallet, total, played, recent: [{ wallet (shortened), at, played }] }
 * `total` is the number of wallets that first connected through this wallet's
 * /r/<wallet> link, `played` how many of them have a run or adventure game.
 * The referrer address is already public (it is in the link), referred wallets
 * are shortened. Cached 30 s at the edge.
 */
import { isWallet } from '@/lib/ranked/auth';
import { referralsConfigured, referralsOf } from '@/lib/referrals/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CACHE = 'public, s-maxage=30, stale-while-revalidate=120';

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get('wallet');
  if (!isWallet(wallet)) return NextResponse.json({ error: 'bad wallet' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if (!referralsConfigured()) return NextResponse.json({ error: 'referrals are not available' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    return NextResponse.json(await referralsOf(wallet), { headers: { 'Cache-Control': CACHE } });
  } catch (e) {
    console.error('referrals', e);
    return NextResponse.json({ error: 'referrals are not available' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
