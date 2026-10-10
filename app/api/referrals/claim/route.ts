/**
 * POST /api/referrals/claim { referrer }  (Authorization: Bearer <ranked session>)
 *   → { result: 'recorded' | 'duplicate' | 'self' | 'existing_player' }
 * Called once when a wallet connects after arriving through /r/<referrer>.
 * Only a wallet with no prior activity can be recorded, once, and never as its
 * own referrer (see lib/referrals/db.ts). Rate limited per IP.
 */
import { fail, json, requireWallet } from '@/lib/ranked/http';
import { readJson } from '@/lib/http/body';
import { isWallet } from '@/lib/ranked/auth';
import { claimReferral, referralsConfigured } from '@/lib/referrals/db';
import { getIP, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!referralsConfigured()) return fail(503, 'referrals are not available');
  const rl = await rateLimit(`referral-claim:${getIP(req)}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) return fail(429, 'too many requests');
  // The referred wallet comes from its signed-in session, never from the body,
  // so nobody can attach a stranger's fresh wallet to their own code.
  const wallet = await requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  const b = await readJson(req, 1024);
  if (b instanceof Response) return b;
  if (!isWallet(b.referrer)) return fail(400, 'bad wallet');
  try {
    return json({ result: await claimReferral(b.referrer, wallet) });
  } catch (e) {
    console.error('referral claim', e);
    return fail(503, 'referrals are not available');
  }
}
