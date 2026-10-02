import { NextResponse } from 'next/server';
import { isWallet } from '@/lib/ranked/auth';
import { body, fail, json } from '@/lib/ranked/http';
import { dbUrl } from './db';
import { authConfigured, challenge, sessionWallet, setCookieHeader, signIn, type Role } from './session';

export { body, fail, json };

/** Wallet of the signed-in admin/partner, or an error response. Checked server-side on every call. */
export function requireRole(req: Request, role: Role): string | Response {
  if (!authConfigured() || !dbUrl()) return fail(503, 'console is not configured on this server');
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
      if (!b || !isWallet(b.wallet)) return fail(400, 'bad wallet');
      if (b.message === undefined) return json({ message: challenge(role, b.wallet) });
      const token = signIn(role, b.wallet, String(b.message), String(b.signature ?? ''));
      if (!token) return fail(401, role === 'admin' ? 'signature check failed or wallet is not an admin' : 'signature check failed');
      const res = NextResponse.json({ wallet: b.wallet }, { headers: { 'Cache-Control': 'no-store' } });
      res.headers.append('Set-Cookie', setCookieHeader(role, token));
      return res;
    },
    async DELETE() {
      const res = NextResponse.json({ ok: true });
      res.headers.append('Set-Cookie', setCookieHeader(role, null));
      return res;
    },
  };
}
