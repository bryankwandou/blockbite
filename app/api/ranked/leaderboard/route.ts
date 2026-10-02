/**
 * GET /api/ranked/leaderboard?period=day&d=YYYY-MM-DD   best run per wallet
 * GET /api/ranked/leaderboard?period=month&m=YYYY-MM    sum of each wallet's 10 best days
 * Defaults to today / this month (UTC).
 * rows: [{ wallet, score, avatarId }]; avatarId is a lib/avatars.ts slug or null.
 */
import { dayBoard, monthBoard } from '@/lib/ranked/db';
import { fail, json, rankedConfigured } from '@/lib/ranked/http';
import { dayOf, isDay } from '@/lib/ranked/seed';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  const p = new URL(req.url).searchParams;
  const today = dayOf(Date.now());
  if (p.get('period') === 'month') {
    const m = p.get('m') ?? today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return fail(400, 'bad month');
    return json({ period: 'month', month: m, rows: await monthBoard(m) });
  }
  const d = p.get('d') ?? today;
  if (!isDay(d)) return fail(400, 'bad day');
  return json({ period: 'day', day: d, final: d < today, rows: await dayBoard(d) });
}
