/**
 * GET  /api/profile/avatar?wallet=<address>   → { wallet, avatarId }   (avatarId null when unset)
 * POST /api/profile/avatar { wallet, avatarId }
 *      Authorization: Bearer <session token from POST /api/ranked/auth>
 *      → { wallet, avatarId }
 *
 * Writing needs the same wallet sign-in as Ranked: the session token proves
 * the caller signed a challenge with `wallet`'s key. Without it the answer is
 * 401 { error, signIn: '/api/ranked/auth' }, and the client keeps its local
 * choice. avatarId is a slug (^[a-z0-9-]{1,40}$, the ids in lib/avatars.ts);
 * null clears it. Block codes (m1-b..-p..-e..-m..-a..-g..) are checked part
 * by part against components/avatar/parts.ts.
 */
import { isWallet } from '@/lib/ranked/auth';
import { AVATAR_ID_RE } from '@/lib/ranked/config';
import { getAvatar, setAvatar } from '@/lib/ranked/db';
import { body, fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';
import { getIP, rateLimit } from '@/lib/rate-limit';
import { isAvatarId } from '@/lib/avatars';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'profiles are not available');
  const wallet = new URL(req.url).searchParams.get('wallet');
  if (!isWallet(wallet)) return fail(400, 'bad wallet');
  return json({ wallet, avatarId: await getAvatar(wallet) });
}

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'profiles are not available');
  const signedIn = requireWallet(req);
  if (typeof signedIn !== 'string') return fail(401, 'sign in with your wallet first', { signIn: '/api/ranked/auth' });
  const b = await body(req);
  if (!b || !isWallet(b.wallet)) return fail(400, 'bad wallet');
  if (b.wallet !== signedIn) return fail(403, 'signed in as a different wallet');
  const avatarId = b.avatarId;
  if (avatarId !== null && (typeof avatarId !== 'string' || !AVATAR_ID_RE.test(avatarId) || !isAvatarId(avatarId))) {
    // Unknown slugs and block codes naming parts that do not exist are refused.
    return fail(400, 'bad avatarId');
  }
  // Each new wallet adds a row; cap how fast one address can add them. The
  // limiter needs Vercel KV; without it (it throws then) the write goes ahead.
  const rl = await rateLimit(`avatar:${getIP(req)}`, 30, 60 * 60_000).catch(() => null);
  if (rl && !rl.allowed) return fail(429, 'too many changes, try again later');
  await setAvatar(signedIn, avatarId);
  return json({ wallet: signedIn, avatarId });
}
