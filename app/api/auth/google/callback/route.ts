/**
 * GET /api/auth/google/callback?code&state — Google redirects here.
 *   Checks state against the signed oauth cookie (CSRF), exchanges the code
 *   with the PKCE verifier, verifies the id_token, then binds (mode bind) or
 *   opens a recovery session (mode recover). Redirects to /account.
 */
import { NextResponse } from 'next/server';
import { same } from '@/lib/auth/core';
import { bindIdentity, findIdentity } from '@/lib/auth/db';
import { exchangeCode, googleConfig } from '@/lib/auth/google';
import { accountsConfigured, clearCookie, COOKIE, limited, notFound, oauthState, sealRecovery, setCookie, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!googleConfig()) return notFound();
  const u = new URL(req.url);
  const to = (q: string) => {
    const res = NextResponse.redirect(new URL(`/account?${q}`, req.url), 303);
    res.headers.set('Cache-Control', 'no-store');
    clearCookie(res, COOKIE.oauth);
    return res;
  };
  if (!accountsConfigured()) return to('err=unavailable');
  if (await limited(req, 'google', 20)) return to('err=rate_limited');
  const st = oauthState(req);
  const state = u.searchParams.get('state') ?? '';
  const code = u.searchParams.get('code');
  if (!st || !state || !same(state, st.st)) return to('err=state');
  if (!code) return to('err=google_denied');
  let claims;
  try {
    claims = await exchangeCode(code, st.v, st.n);
  } catch (e) {
    return to(`err=${(e as Error).message === 'email_unverified' ? 'email_unverified' : 'google_failed'}`);
  }
  if (st.mode === 'bind') {
    const ws = walletSession(req);
    if (!ws || ws.w !== st.w) return to('err=wallet_session');
    const r = await bindIdentity({ wallet: ws.w, provider: 'google', subject: claims.sub, email: claims.email, passwordHash: null });
    return to(r === 'ok' ? 'ok=google_bound' : `err=${r}`);
  }
  const id = await findIdentity('google', claims.sub);
  if (!id) return to('err=not_bound');
  const res = to('ok=recovery');
  setCookie(res, COOKIE.recover, sealRecovery({ w: id.wallet, p: 'google', s: claims.sub, m: claims.email }));
  return res;
}
