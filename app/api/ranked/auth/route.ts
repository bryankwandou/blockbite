/**
 * POST /api/ranked/auth
 *   { wallet }                        → { message }  (text to sign)
 *   { wallet, message, signature }    → { token }    (session, 12 h)
 */
import { challenge, isWallet, signInOnce } from '@/lib/ranked/auth';
import { body, fail, json, rankedConfigured } from '@/lib/ranked/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const b = await body(req);
  if (!b || !isWallet(b.wallet)) return fail(400, 'bad wallet');
  if (b.message === undefined) return json({ message: challenge(b.wallet) });
  let token: string | null;
  try {
    // Single-use: a captured signed challenge cannot mint a second session.
    token = await signInOnce(b.wallet, String(b.message), String(b.signature ?? ''));
  } catch (e) {
    console.error('ranked auth nonce', e);
    return fail(503, 'sign-in is unavailable, try again');
  }
  return token ? json({ token }) : fail(401, 'signature check failed');
}
