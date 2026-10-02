/**
 * POST   /api/auth/wallet { wallet, message, signature }  (action "manage")
 *        → sets the 15-minute wallet session cookie used to bind methods.
 * DELETE /api/auth/wallet → clears the wallet and recovery cookies.
 */
import { NextResponse } from 'next/server';
import { verifyWalletSignature } from '@/lib/auth/core';
import { accountsConfigured, body, clearCookie, COOKIE, fail, limited, sealWallet, setCookie } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available');
  if (await limited(req, 'wallet', 30)) return fail(429, 'too many attempts, try again later');
  const b = await body(req);
  if (!b || !verifyWalletSignature(b.wallet, 'manage', b.message, b.signature)) return fail(401, 'bad signature');
  const res = NextResponse.json({ wallet: b.wallet }, { headers: { 'Cache-Control': 'no-store' } });
  setCookie(res, COOKIE.wallet, sealWallet(b.wallet as string));
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  clearCookie(res, COOKIE.wallet);
  clearCookie(res, COOKIE.recover);
  return res;
}
