/**
 * GET /api/auth/challenge?wallet=<addr>&action=<manage|unbind:google|unbind:password|migrate:<oldWallet>>
 *   → { message }  — plain text for the wallet to sign (not a transaction).
 */
import { isAction, isWallet, walletChallenge } from '@/lib/auth/core';
import { accountsConfigured, fail, json } from '@/lib/auth/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!accountsConfigured()) return fail(503, 'accounts are not available');
  const u = new URL(req.url);
  const wallet = u.searchParams.get('wallet');
  const action = u.searchParams.get('action');
  if (!isWallet(wallet)) return fail(400, 'bad wallet');
  if (!isAction(action)) return fail(400, 'bad action');
  return json({ message: walletChallenge(wallet, action) });
}
