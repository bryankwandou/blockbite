/**
 * POST /api/auth/passkey/register { clientDataJSON, attestationObject }  (base64url)
 *   Needs the wallet session and the bind challenge cookie. Verifies the
 *   attestation (fmt "none", ES256/RS256) and binds the passkey to the wallet.
 */
import { NextResponse } from 'next/server';
import { addPasskey } from '@/lib/auth/db';
import { verifyRegistration, type NewCredential } from '@/lib/auth/webauthn';
import { accountsConfigured, body, clearCookie, COOKIE, fail, limited, passkeyChallenge, relyingParty, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available', { code: 'unavailable' });
  if (await limited(req, 'bind', 10)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const ws = walletSession(req);
  if (!ws) return fail(401, 'sign with your wallet first', { code: 'wallet_session' });
  const pc = passkeyChallenge(req);
  if (!pc || pc.mode !== 'bind' || pc.w !== ws.w) return fail(400, 'challenge expired', { code: 'passkey_expired' });
  const b = await body(req);
  let cred: NewCredential;
  try {
    cred = verifyRegistration(
      { clientDataJSON: String(b?.clientDataJSON ?? ''), attestationObject: String(b?.attestationObject ?? '') },
      { challenge: pc.c, ...relyingParty(req) },
    );
  } catch {
    return fail(400, 'passkey could not be verified', { code: 'passkey_failed' });
  }
  const r = await addPasskey({ wallet: ws.w, ...cred });
  if (r !== 'ok') return fail(409, 'cannot bind', { code: r });
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  clearCookie(res, COOKIE.passkey);
  return res;
}
