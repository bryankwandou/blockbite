/**
 * GET /api/auth/google/start?mode=bind|recover
 *   Redirects to Google (authorization code + PKCE S256, state, nonce).
 *   bind needs the wallet session cookie. 404 unless GOOGLE_CLIENT_ID,
 *   GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are all set.
 */
import { NextResponse } from 'next/server';
import { pkcePair, randomToken } from '@/lib/auth/core';
import { authorizeUrl, googleConfig } from '@/lib/auth/google';
import { accountsConfigured, COOKIE, notFound, sealOAuth, setCookie, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const back = (err: string) => NextResponse.redirect(new URL(`/account?err=${err}`, req.url), 303);
  const cfg = googleConfig();
  if (!cfg) return notFound();
  if (!accountsConfigured()) return back('unavailable');
  const mode = new URL(req.url).searchParams.get('mode') === 'bind' ? 'bind' : 'recover';
  const ws = walletSession(req);
  if (mode === 'bind' && !ws) return back('wallet_session');
  const { verifier, challenge } = pkcePair();
  const state = randomToken();
  const nonce = randomToken();
  const res = NextResponse.redirect(authorizeUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, nonce, challenge }), 303);
  res.headers.set('Cache-Control', 'no-store');
  setCookie(res, COOKIE.oauth, sealOAuth({ st: state, v: verifier, n: nonce, mode, w: mode === 'bind' ? ws!.w : null }), 10 * 60_000);
  return res;
}
