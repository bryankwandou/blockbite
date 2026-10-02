/**
 * POST /api/auth/email { email, password }  (needs the wallet session cookie)
 *   Binds email + password to the signed-in wallet. The password is hashed
 *   with scrypt and never logged or returned.
 */
import { hashPassword, normalizeEmail, passwordProblem } from '@/lib/auth/core';
import { bindIdentity } from '@/lib/auth/db';
import { accountsConfigured, body, fail, json, limited, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available');
  const ws = walletSession(req);
  if (!ws) return fail(401, 'sign with your wallet first', { code: 'wallet_session' });
  if (await limited(req, 'bind', 10)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const b = await body(req);
  const email = normalizeEmail(b?.email);
  if (!email) return fail(400, 'bad email', { code: 'email_invalid' });
  const problem = passwordProblem(b?.password, email);
  if (problem) return fail(400, 'weak password', { code: problem });
  const r = await bindIdentity({
    wallet: ws.w, provider: 'password', subject: email, email, passwordHash: await hashPassword(b!.password as string),
  });
  if (r !== 'ok') return fail(409, 'cannot bind', { code: r });
  return json({ ok: true });
}
