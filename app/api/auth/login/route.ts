/**
 * POST /api/auth/login { email, password }
 *   Recovery sign-in. On success sets the 15-minute recovery cookie for the
 *   wallet this email is bound to. 10 failures per email per hour lock it.
 */
import { NextResponse } from 'next/server';
import { hashPassword, isLocked, normalizeEmail, recordFailure, verifyPassword } from '@/lib/auth/core';
import { failureStore, findIdentity } from '@/lib/auth/db';
import { accountsConfigured, body, COOKIE, fail, limited, sealRecovery, setCookie } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

let dummy: Promise<string> | null = null; // compared against when the email is unknown, so timing matches

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available');
  if (await limited(req, 'login', 20)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const b = await body(req);
  const email = normalizeEmail(b?.email);
  const password = typeof b?.password === 'string' ? b.password : '';
  if (!email || !password || password.length > 256) return fail(400, 'bad request', { code: 'bad_login' });
  const keys = [`email:${email}`];
  if (await isLocked(failureStore, keys)) return fail(423, 'locked, try again in an hour', { code: 'locked' });
  const id = await findIdentity('password', email);
  const ok = await verifyPassword(password, id?.password_hash ?? (await (dummy ??= hashPassword('not-a-real-password-x'))));
  if (!id || !ok) {
    await recordFailure(failureStore, keys);
    return fail(401, 'wrong email or password', { code: 'bad_login' });
  }
  const res = NextResponse.json({ wallet: id.wallet }, { headers: { 'Cache-Control': 'no-store' } });
  setCookie(res, COOKIE.recover, sealRecovery({ w: id.wallet, p: 'password', s: email, m: email }));
  return res;
}
