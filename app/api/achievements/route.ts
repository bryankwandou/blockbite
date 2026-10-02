/**
 * GET /api/achievements?wallet=<address> → { wallet, unlocks: [{ id, at }] }
 * Reached achievement ids are stored in Neon only (see lib/achievements/db.ts).
 */
import { isWallet } from '@/lib/ranked/auth';
import { fail, json } from '@/lib/ranked/http';
import { achievementsConfigured, unlocksOf } from '@/lib/achievements/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!achievementsConfigured()) return fail(503, 'achievements are not available');
  const wallet = new URL(req.url).searchParams.get('wallet');
  if (!isWallet(wallet)) return fail(400, 'bad wallet');
  return json({ wallet, unlocks: await unlocksOf(wallet) });
}
