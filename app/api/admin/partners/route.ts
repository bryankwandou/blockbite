/** GET: partner applications + campaigns. POST { wallet, status: approved|rejected } (admin only). */
import { isWallet } from '@/lib/ranked/auth';
import { body, fail, json, requireRole } from '@/lib/admin/http';
import { decide, listPartners } from '@/lib/partner/campaigns';
import { distribution } from '@/lib/partner/server';
import { campaignView } from '@/lib/partner/view';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const w = requireRole(req, 'admin');
  if (w instanceof Response) return w;
  const [partners, list] = await Promise.all([listPartners(), distribution().listCampaigns(null)]);
  return json({ source: 'ptn_partners, ptn_dist_campaigns', partners, campaigns: list.map(campaignView) });
}

export async function POST(req: Request) {
  const admin = requireRole(req, 'admin');
  if (admin instanceof Response) return admin;
  const b = await body(req);
  if (!b || !isWallet(b.wallet) || (b.status !== 'approved' && b.status !== 'rejected')) return fail(400, 'bad request');
  return (await decide(b.wallet, b.status, admin)) ? json({ ok: true }) : fail(404, 'no such application');
}
