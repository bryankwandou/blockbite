/**
 * POST /api/auth/passkey/login { id, clientDataJSON, authenticatorData, signature }  (base64url)
 *   Recovery sign-in with a bound passkey. Needs the recover challenge cookie.
 *   Checks challenge, origin, rpIdHash, UP flag, signature and signCount, then
 *   sets the 15-minute recovery cookie. 10 failures per credential (or IP) per hour lock it.
 */
import { NextResponse } from 'next/server';
import { isLocked, recordFailure } from '@/lib/auth/core';
import { bumpSignCount, failureStore, findPasskey } from '@/lib/auth/db';
import { verifyAssertion } from '@/lib/auth/webauthn';
import {
  accountsConfigured, body, clearCookie, COOKIE, fail, getIP, limited, passkeyChallenge, relyingParty, sealRecovery, setCookie,
} from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available', { code: 'unavailable' });
  if (await limited(req, 'login', 20)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const pc = passkeyChallenge(req);
  if (!pc || pc.mode !== 'recover') return fail(400, 'challenge expired', { code: 'passkey_expired' });
  const b = await body(req);
  const id = typeof b?.id === 'string' && /^[\w-]{16,1400}$/.test(b.id) ? b.id : null;
  if (!id) return fail(400, 'bad request', { code: 'passkey_failed' });
  const keys = [`passkey:${id}`, `pkip:${getIP(req)}`];
  if (await isLocked(failureStore, keys)) return fail(423, 'locked, try again in an hour', { code: 'locked' });
  const pk = await findPasskey(id);
  let count: number | null = null;
  if (pk) {
    try {
      count = verifyAssertion(
        { clientDataJSON: String(b?.clientDataJSON ?? ''), authenticatorData: String(b?.authenticatorData ?? ''), signature: String(b?.signature ?? '') },
        { publicKey: pk.public_key, alg: pk.alg, signCount: pk.sign_count },
        { challenge: pc.c, ...relyingParty(req) },
      );
    } catch {
      count = null;
    }
  }
  if (!pk || count === null || !(await bumpSignCount(pk.id, pk.sign_count, count))) {
    await recordFailure(failureStore, keys);
    return fail(401, 'passkey not recognised', { code: pk ? 'passkey_failed' : 'passkey_unknown' });
  }
  const res = NextResponse.json({ wallet: pk.wallet }, { headers: { 'Cache-Control': 'no-store' } });
  clearCookie(res, COOKIE.passkey);
  setCookie(res, COOKIE.recover, sealRecovery({ w: pk.wallet, p: 'passkey', s: pk.credential_id, m: null }));
  return res;
}
