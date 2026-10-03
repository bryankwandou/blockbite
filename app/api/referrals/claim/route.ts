/**
 * POST /api/referrals/claim { referrer, wallet }
 *   → { result: 'recorded' | 'duplicate' | 'self' | 'existing_player' }
 * Called once when a wallet connects after arriving through /r/<referrer>.
 * Only a wallet with no prior activity can be recorded, once, and never as its
 * own referrer (see lib/referrals/db.ts). Rate limited per IP.
 */
import { body, fail, json } from '@/lib/ranked/http';
import { isWallet } from '@/lib/ranked/auth';
import { claimReferral, referralsConfigured } from '@/lib/referrals/db';
import { getIP, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!referralsConfigured()) return fail(503, 'referrals are not available');
  const rl = await rateLimit(`referral-claim:${getIP(req)}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) return fail(429, 'too many requests');
  const b = await body(req);
  if (!b || !isWallet(b.referrer) || !isWallet(b.wallet)) return fail(400, 'bad wallet');
  try {
    return json({ result: await claimReferral(b.referrer, b.wallet) });
  } catch (e) {
    console.error('referral claim', e);
    return fail(503, 'referrals are not available');
  }
}
