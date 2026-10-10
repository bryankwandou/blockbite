/** GET /api/ranked/run?id= — current state of one of your runs (to resume after a reload). */
import { getRun } from '@/lib/ranked/db';
import { fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';
import { dayOf } from '@/lib/ranked/seed';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const wallet = await requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  const id = new URL(req.url).searchParams.get('id');
  const run = id ? await getRun(id) : null;
  if (!run || run.wallet !== wallet) return fail(404, 'run not found');
  const closed = run.over || run.day !== dayOf(Date.now());
  return json({ runId: run.id, day: run.day, attempt: run.attempt, state: run.state, closed });
}
