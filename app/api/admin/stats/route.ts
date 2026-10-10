/** GET ?tab=traffic|money|players|health (admin only). */
import { fail, json, requireRole } from '@/lib/admin/http';
import { health, money, players, traffic } from '@/lib/admin/stats';

export const dynamic = 'force-dynamic';

const TABS = { traffic, money, players, health } as const;

export async function GET(req: Request) {
  const w = requireRole(req, 'admin');
  if (w instanceof Response) return w;
  const tab = new URL(req.url).searchParams.get('tab') ?? '';
  if (!Object.hasOwn(TABS, tab)) return fail(400, 'unknown tab');
  try {
    return json(await TABS[tab as keyof typeof TABS]());
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : String(e));
  }
}
