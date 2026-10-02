/**
 * POST /api/auth/unbind { wallet, provider, message, signature }
 *   provider: google | password | passkey (all passkeys) | codes (all recovery codes).
 *   Needs a fresh wallet signature for action "unbind:<provider>".
 */
import { verifyWalletSignature } from '@/lib/auth/core';
import { removeCodes, removePasskeys, unbindIdentity } from '@/lib/auth/db';
import { accountsConfigured, body, fail, json, limited } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available');
  if (await limited(req, 'unbind', 20)) return fail(429, 'too many attempts, try again later');
  const b = await body(req);
  const provider = b?.provider;
  if (provider !== 'google' && provider !== 'password' && provider !== 'passkey' && provider !== 'codes') return fail(400, 'bad provider');
  if (!verifyWalletSignature(b!.wallet, `unbind:${provider}`, b!.message, b!.signature)) return fail(401, 'bad signature');
  const w = b!.wallet as string;
  const removed = provider === 'passkey' ? (await removePasskeys(w)) > 0
    : provider === 'codes' ? (await removeCodes(w)) > 0
    : await unbindIdentity(w, provider);
  return removed ? json({ ok: true }) : fail(404, 'not bound');
}
