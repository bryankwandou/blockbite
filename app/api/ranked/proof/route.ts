/**
 * GET /api/ranked/proof?wallet=<address>[&round=<round id>]
 *
 * The wallet's prizes in posted rounds that can still be claimed (or will
 * be once their 24 h veto window ends), each with its merkle proof:
 *   { wallet, prizes: [{ roundId, kind, period, rank, score, index, amount,
 *     proof: hex[], root, round, postSig, postedAt, claimableAt, expiresAt }] }
 * Amounts are USDC base units as decimal strings. Proofs are public: a claim
 * can only ever pay the winning wallet's own USDC account.
 * Feed a prize to claimIxs() in lib/ranked/prize-ix.ts to build the claim.
 */
import { isWallet } from '@/lib/ranked/auth';
import { PRIZE_CLAIM_WINDOW_S } from '@/lib/ranked/config';
import { roundsWithWallet } from '@/lib/ranked/db';
import { fail, json, rankedConfigured } from '@/lib/ranked/http';
import { prizeIn } from '@/lib/ranked/results';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const p = new URL(req.url).searchParams;
  const wallet = p.get('wallet');
  if (!isWallet(wallet)) return fail(400, 'bad wallet');
  const round = p.get('round');
  if (round !== null && !/^\d{1,19}$/.test(round)) return fail(400, 'bad round');

  const rows = await roundsWithWallet(wallet, Date.now() - PRIZE_CLAIM_WINDOW_S * 1000);
  const prizes = rows
    .filter((r) => round === null || r.roundId.toString() === round)
    .map((r) => prizeIn(r, wallet))
    .filter((x) => x !== null);
  return json({ wallet, prizes });
}
