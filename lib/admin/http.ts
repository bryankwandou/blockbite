import { NextResponse } from 'next/server';
import { isCrossSiteMutation } from '@/lib/http/origin';
import { isWallet } from '@/lib/ranked/auth';
import { body, fail, json } from '@/lib/ranked/http';
import { dbUrl } from './db';
import { authConfigured, challenge, sessionWallet, setCookieHeader, signInOnce, type Role } from './session';

export { body, fail, json };

/** Wallet of the signed-in admin/partner, or an error response. Checked server-side on every call. */
export function requireRole(req: Request, role: Role): string | Response {
  if (!authConfigured() || !dbUrl()) return fail(503, 'console is not configured on this server');
  if (isCrossSiteMutation(req)) return fail(403, 'cross-site request refused');
  return sessionWallet(req, role) ?? fail(401, 'sign in first');
}

/**
 * Shared sign-in endpoint body.
 *   GET                              → { wallet | null }
 *   POST { wallet }                  → { message }
 *   POST { wallet, message, signature } → sets httpOnly cookie
 *   DELETE                           → clears cookie
 */
export function authHandlers(role: Role) {
  return {
    async GET(req: Request) {
      return json({ wallet: authConfigured() ? sessionWallet(req, role) : null, configured: authConfigured() && Boolean(dbUrl()) });
    },
    async POST(req: Request) {
      if (!authConfigured()) return fail(503, 'console is not configured on this server');
      const b = await body(req);
      if (!b) return fail(400, 'bad request');
      // Wrong/missing credentials on the verify step are an auth failure (401); a malformed first request stays 400.
      if (!isWallet(b.wallet)) return b.message === undefined ? fail(400, 'bad wallet') : fail(401, 'signature check failed');
      if (b.message === undefined) return json({ message: challenge(role, b.wallet) });
      let token: string | null;
      try {
        token = await signInOnce(role, b.wallet, String(b.message), String(b.signature ?? ''));
      } catch {
        return fail(503, 'sign-in is temporarily unavailable');
      }
      if (!token) return fail(401, role === 'admin' ? 'signature check failed or wallet is not an admin' : 'signature check failed');
      const res = NextResponse.json({ wallet: b.wallet }, { headers: { 'Cache-Control': 'no-store' } });
      res.headers.append('Set-Cookie', setCookieHeader(role, token));
      return res;
    },
    async DELETE(req: Request) {
      if (isCrossSiteMutation(req)) return fail(403, 'cross-site request refused');
      const res = NextResponse.json({ ok: true });
      res.headers.append('Set-Cookie', setCookieHeader(role, null));
      return res;
    },
  };
}
