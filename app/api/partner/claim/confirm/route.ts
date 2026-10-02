/** POST { allocationId, signature? } (Bearer ranked session): settle a pending claim. */
import { body, fail, json } from '@/lib/admin/http';
import { playerGuard } from '@/lib/partner/player';
import { distribution } from '@/lib/partner/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const wallet = await playerGuard(req, 'confirm', 20);
  if (wallet instanceof Response) return wallet;
  const b = await body(req);
  if (typeof b?.allocationId !== 'string') return fail(400, 'bad request');
  const a = await distribution().confirm(b.allocationId, wallet, typeof b.signature === 'string' ? b.signature : undefined);
  return a ? json({ status: a.status, txSig: a.txSig }) : fail(404, 'no such reward for this wallet');
}
