/** POST { campaignId, paused }: pause or resume claims and new allocations. */
import { body, fail, json, requireRole } from '@/lib/admin/http';
import { distribution } from '@/lib/partner/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const w = requireRole(req, 'partner');
  if (w instanceof Response) return w;
  const b = await body(req);
  if (typeof b?.campaignId !== 'string' || typeof b.paused !== 'boolean') return fail(400, 'bad request');
  return (await distribution().setPaused(b.campaignId, w, b.paused)) ? json({ ok: true, paused: b.paused }) : fail(404, 'no such campaign');
}
