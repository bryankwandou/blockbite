/**
 * POST /api/ranked/credit { signature }
 * Verifies a ticket purchase transaction on mainnet and credits its tickets
 * to the signed-in wallet, once per transaction.
 */
import { RPC_URL } from '@/lib/solana/config';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import { creditPurchase, getCredits } from '@/lib/ranked/db';
import { body, fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';
import { fetchParsedTx, verifyPurchaseTx } from '@/lib/ranked/purchase-verify';
import { getIP } from '@/lib/rate-limit';
import { limit } from '@/lib/versus/limit';

export const dynamic = 'force-dynamic';

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  if (!RANKED_SALES_OPEN) return fail(503, 'ticket sales are not open yet');
  const wallet = requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  const b = await body(req);
  const sig = b?.signature;
  if (typeof sig !== 'string' || !SIG_RE.test(sig)) return fail(400, 'bad signature');
  // Every call costs an RPC read: cap it per wallet and per IP (shared count in
  // Postgres) so a loop of junk signatures cannot drain the RPC plan for everyone.
  // A real buyer polls every few seconds until finality, far below this. The IP
  // cap is loose because mobile carriers put many players behind one IP.
  if (!(await limit(`rk:credit:w:${wallet}`, 120, 10 * 60_000)) || !(await limit(`rk:credit:ip:${getIP(req)}`, 3000, 10 * 60_000))) {
    return fail(429, 'too many requests, try again in a few minutes');
  }

  let tx;
  try {
    tx = await fetchParsedTx(RPC_URL, sig);
  } catch {
    return fail(502, 'could not reach Solana, try again');
  }
  if (!tx) return fail(404, 'transaction not confirmed yet, try again in a few seconds');
  const v = verifyPurchaseTx(tx, wallet);
  if (typeof v === 'string') return fail(422, v);

  const added = await creditPurchase({ sig, wallet, ...v });
  return json({ added: added ? v.tickets : 0, alreadyCredited: !added, credits: await getCredits(wallet) });
}
