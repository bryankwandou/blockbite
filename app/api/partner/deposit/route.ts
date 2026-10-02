/** POST { campaignId, signature }: read-only on-chain check of a deposit to the distributor. */
import { body, fail, json, requireRole } from '@/lib/admin/http';
import { fromBase } from '@/lib/partner/distribution';
import { distribution } from '@/lib/partner/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const w = requireRole(req, 'partner');
  if (w instanceof Response) return w;
  const b = await body(req);
  const d = distribution();
  const c = typeof b?.campaignId === 'string' ? await d.getCampaign(b.campaignId) : null;
  if (!c || c.partner !== w) return fail(404, 'no such campaign');
  const r = await d.verifyDeposit(c, String(b?.signature ?? '').trim());
  return typeof r === 'string' ? fail(400, r) : json({ amount: fromBase(r.amount, c.decimals) });
}
