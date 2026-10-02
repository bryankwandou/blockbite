/**
 * POST /api/auth/recover { wallet, message, signature }
 *   Needs the recovery cookie (Google or email sign-in). `wallet` is the NEW
 *   wallet; it signs action "migrate:<oldWallet>". Moves the bound sign-in
 *   methods and the off-chain profile, marks the old wallet migrated.
 *   Tokens, USDC, ranked tickets and unclaimed prizes stay with the old wallet.
 */
import { NextResponse } from 'next/server';
import { cooldownLeft, verifyWalletSignature } from '@/lib/auth/core';
import { lastMigrationInto, moveAccount } from '@/lib/auth/db';
import { accountsConfigured, body, clearCookie, COOKIE, fail, limited, recoverySession, sealWallet, setCookie } from '@/lib/auth/http';
import { copyProfile } from '@/lib/auth/profile';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available');
  const rs = recoverySession(req);
  if (!rs) return fail(401, 'sign in with Google or email first', { code: 'recovery_session' });
  if (await limited(req, 'recover', 10)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const b = await body(req);
  if (!b || !verifyWalletSignature(b.wallet, `migrate:${rs.w}`, b.message, b.signature)) return fail(401, 'bad signature', { code: 'bad_signature' });
  const to = b.wallet as string;
  if (to === rs.w) return fail(400, 'that is the same wallet', { code: 'same_wallet' });
  const left = cooldownLeft(await lastMigrationInto(rs.w));
  if (left > 0) return fail(429, 'cooldown', { code: 'cooldown', cooldownLeftMs: left });
  if ((await moveAccount(rs.w, to, rs.p)) !== 'ok') return fail(409, 'cannot move to that wallet', { code: 'refused' });
  const moved = await copyProfile(rs.w, to);
  const res = NextResponse.json({ ok: true, from: rs.w, to, moved }, { headers: { 'Cache-Control': 'no-store' } });
  clearCookie(res, COOKIE.recover);
  setCookie(res, COOKIE.wallet, sealWallet(to));
  return res;
}
