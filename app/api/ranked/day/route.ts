/**
 * GET /api/ranked/day?d=YYYY-MM-DD
 *
 * Today and the next 7 days: the seed commitment sha256(seed) only.
 * Finished days: the seed itself, the final leaderboard and every run's full
 * move log, so anyone can re-deal the trays and recompute every score
 * (scripts/verify-ranked-day.ts).
 */
import { PUBLISHED_BOARD_LIMIT } from '@/lib/ranked/config';
import { dayBoard, dayRuns } from '@/lib/ranked/db';
import { fail, json, rankedConfigured } from '@/lib/ranked/http';
import { commitment, dailySeed, dayOf, isDay } from '@/lib/ranked/seed';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;
/**
 * The seed is revealed only this long after the day ends. /play refuses a
 * run once its day is over by the serving instance's clock; without a margin
 * a request racing midnight (or an instance a little behind) could still
 * place pieces after the seed, and so every future tray, was public.
 */
const REVEAL_GRACE_MS = 10 * 60_000;

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const d = new URL(req.url).searchParams.get('d') ?? dayOf(Date.now());
  if (!isDay(d)) return fail(400, 'bad day');
  const now = Date.now();
  if (d > dayOf(now + 7 * DAY_MS)) return fail(404, 'too far ahead');
  const seed = dailySeed(d);
  if (d >= dayOf(now - REVEAL_GRACE_MS)) return json({ day: d, final: false, commitment: commitment(seed) });
  const [leaderboard, runs] = await Promise.all([dayBoard(d, PUBLISHED_BOARD_LIMIT), dayRuns(d)]);
  return json({ day: d, final: true, commitment: commitment(seed), seed, leaderboard, runs });
}
