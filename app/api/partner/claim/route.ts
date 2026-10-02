/**
 * POST { allocationId } (Bearer ranked session): returns a transaction that
 * creates the player's token account if needed and transfers the reward.
 * Fee payer = player; the distributor has already signed its part.
 */
import { body, fail, json } from '@/lib/admin/http';
import { playerGuard } from '@/lib/partner/player';
import { distribution } from '@/lib/partner/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const wallet = await playerGuard(req, 'claim', 6);
  if (wallet instanceof Response) return wallet;
  const b = await body(req);
  if (typeof b?.allocationId !== 'string') return fail(400, 'bad request');
  const r = await distribution().claim(b.allocationId, wallet);
  return r.ok ? json(r) : fail(r.status, r.error);
}
