/** GET /api/ranked/me — credits, today's attempts and runs of the signed-in wallet. */
import { MAX_ATTEMPTS_PER_DAY, RANKED_SALES_OPEN } from '@/lib/ranked/config';
import { getCredits, runsOf } from '@/lib/ranked/db';
import { fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';
import { commitment, dailySeed, dayOf } from '@/lib/ranked/seed';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const wallet = requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  const day = dayOf(Date.now());
  const [credits, runs] = await Promise.all([getCredits(wallet), runsOf(wallet, day)]);
  return json({
    wallet,
    day,
    commitment: commitment(dailySeed(day)),
    credits,
    attempts: runs.length,
    maxAttempts: MAX_ATTEMPTS_PER_DAY,
    salesOpen: RANKED_SALES_OPEN,
    runs: runs.map((r) => ({ id: r.id, attempt: r.attempt, score: r.score, moves: r.moves, over: r.over })),
  });
}
