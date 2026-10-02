/**
 * POST /api/auth/codes/login { wallet, code }
 *   Recovery sign-in with a one-time code; `wallet` is the LOST wallet's
 *   address. A matching unused code is marked used and the 15-minute recovery
 *   cookie is set. Same lockout as passwords: 10 failures per wallet per hour.
 */
import { NextResponse } from 'next/server';
import { hashPassword, isLocked, isWallet, normalizeRecoveryCode, recordFailure, verifyPassword } from '@/lib/auth/core';
import { failureStore, unusedCodes, useCode } from '@/lib/auth/db';
import { accountsConfigured, body, COOKIE, fail, limited, sealRecovery, setCookie } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

let dummy: Promise<string> | null = null; // keeps timing similar when the wallet has no codes

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available', { code: 'unavailable' });
  if (await limited(req, 'login', 20)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const b = await body(req);
  const wallet = typeof b?.wallet === 'string' ? b.wallet.trim() : '';
  const code = normalizeRecoveryCode(b?.code);
  if (!isWallet(wallet) || !code) return fail(400, 'bad request', { code: 'bad_code' });
  const keys = [`codes:${wallet}`];
  if (await isLocked(failureStore, keys)) return fail(423, 'locked, try again in an hour', { code: 'locked' });
  const rows = await unusedCodes(wallet);
  let hit: number | null = null;
  if (!rows.length) await verifyPassword(code, await (dummy ??= hashPassword('NOTAREALCODE2345')));
  for (const r of rows) {
    if (await verifyPassword(code, r.code_hash)) { hit = r.id; break; }
  }
  if (hit === null || !(await useCode(hit))) {
    await recordFailure(failureStore, keys);
    return fail(401, 'wrong wallet or code', { code: 'bad_code' });
  }
  const res = NextResponse.json({ wallet, left: rows.length - 1 }, { headers: { 'Cache-Control': 'no-store' } });
  setCookie(res, COOKIE.recover, sealRecovery({ w: wallet, p: 'code', s: String(hit), m: null }));
  return res;
}
