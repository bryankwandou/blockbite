/**
 * GET /api/ranked/referrer → { referrer: string | null }
 * The referrer recorded for the signed-in wallet (ref_signups). The shop pays
 * the 5% referral share only to this wallet's USDC account, because
 * /api/ranked/credit refuses any other referral recipient (purchase-verify.ts).
 */
import { referrerOf } from '@/lib/ranked/db';
import { fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const wallet = await requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  try {
    return json({ referrer: await referrerOf(wallet) });
  } catch (e) {
    console.error('ranked referrer', e);
    return fail(503, 'ranked is not available');
  }
}
