/**
 * GET: this partner's application, campaigns (allocations synced first), totals,
 *      deposits, recipients and the deposit target per campaign.
 * POST { name, tokenMint, contact }: apply (or re-apply while not approved).
 */
import { body, fail, json, requireRole } from '@/lib/admin/http';
import { apply, getPartner } from '@/lib/partner/campaigns';
import { RULE_KINDS } from '@/lib/partner/types';
import { fromBase } from '@/lib/partner/distribution';
import { distribution } from '@/lib/partner/server';
import { allocationView, campaignView, totalsView } from '@/lib/partner/view';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const w = requireRole(req, 'partner');
  if (w instanceof Response) return w;
  const partner = await getPartner(w);
  const d = distribution();
  const list = partner?.status === 'approved' ? await d.listCampaigns(w) : [];
  const campaigns = [];
  for (const c of list) {
    await d.syncCampaign(c).catch((e) => console.error('partner sync', e));
    const s = await d.stats(c);
    campaigns.push({
      ...campaignView(c),
      deposit: d.depositTarget(c),
      totals: totalsView(s.totals, c.decimals),
      deposits: s.deposits.map((x) => ({ ...x, amount: fromBase(x.amount, c.decimals) })),
      recipients: s.allocations.map((a) => allocationView(a, c.decimals)),
      paidPerDay: s.paidPerDay.map((x) => ({ day: x.day, amount: Number(fromBase(x.amount, c.decimals)) })),
    });
  }
  return json({ wallet: w, partner, campaigns, distributor: d.distributorAddress, rules: RULE_KINDS });
}

export async function POST(req: Request) {
  const w = requireRole(req, 'partner');
  if (w instanceof Response) return w;
  const b = await body(req);
  if (!b) return fail(400, 'bad request');
  const err = await apply(w, b);
  return err ? fail(400, err) : json({ ok: true });
}
