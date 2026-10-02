/**
 * POST /api/auth/codes  (needs the wallet session cookie)
 *   → { codes: string[10] }, shown ONCE. Only scrypt hashes are stored; any
 *   earlier codes for this wallet stop working.
 */
import { generateRecoveryCodes, hashPassword, normalizeRecoveryCode } from '@/lib/auth/core';
import { replaceCodes } from '@/lib/auth/db';
import { accountsConfigured, fail, json, limited, walletSession } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available', { code: 'unavailable' });
  const ws = walletSession(req);
  if (!ws) return fail(401, 'sign with your wallet first', { code: 'wallet_session' });
  if (await limited(req, 'bind', 10)) return fail(429, 'too many attempts, try again later', { code: 'rate_limited' });
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => hashPassword(normalizeRecoveryCode(c)!)));
  const r = await replaceCodes(ws.w, hashes);
  if (r !== 'ok') return fail(409, 'cannot bind', { code: r });
  return json({ codes });
}
