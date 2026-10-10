/**
 * POST /api/ranked/start — spends one credit and opens today's next attempt.
 * Every run starts from the empty board; its trays come from runSeed(day, run id).
 */
import { randomUUID } from 'node:crypto';
import { MAX_ATTEMPTS_PER_DAY } from '@/lib/ranked/config';
import { startRun } from '@/lib/ranked/db';
import { fail, json, rankedConfigured, requireWallet } from '@/lib/ranked/http';
import { boardToHex, initialState } from '@/lib/ranked/rules';
import { dailySeed, dayOf, runSeed, trayFor } from '@/lib/ranked/seed';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const wallet = await requireWallet(req);
  if (typeof wallet !== 'string') return wallet;
  const day = dayOf(Date.now());
  const id = randomUUID();
  const state = initialState(trayFor(runSeed(dailySeed(day), id), boardToHex(0n), 0));
  const r = await startRun(id, wallet, day, state);
  if (!r.ok) {
    if (r.reason === 'no_credits') return fail(402, 'no tickets left');
    if (r.reason === 'max_attempts') return fail(429, `only ${MAX_ATTEMPTS_PER_DAY} ranked attempts per day`);
    return fail(409, 'another attempt is starting, try again');
  }
  return json({ runId: id, day, attempt: r.attempt, state });
}
