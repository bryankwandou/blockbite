/** POST: create a distribution campaign (approved partners only). Moves no funds. */
import { body, fail, json, requireRole } from '@/lib/admin/http';
import { getPartner } from '@/lib/partner/campaigns';
import { distribution } from '@/lib/partner/server';
import { campaignView } from '@/lib/partner/view';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const w = requireRole(req, 'partner');
  if (w instanceof Response) return w;
  if ((await getPartner(w))?.status !== 'approved') return fail(403, 'partner is not approved yet');
  const b = await body(req);
  if (!b) return fail(400, 'bad request');
  const r = await distribution().createCampaign(w, b);
  return typeof r === 'string' ? fail(400, r) : json(campaignView(r), 201);
}
