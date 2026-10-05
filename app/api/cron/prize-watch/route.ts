/**
 * GET /api/cron/prize-watch
 * Compares on-chain prize rounds with rk_rounds (lib/ranked/watch.ts) and
 * alerts ALERT_WEBHOOK_URL when a round was posted that the server did not make.
 * Auth: Authorization: Bearer <CRON_SECRET or ADMIN_SECRET> (Vercel Cron sends CRON_SECRET).
 * 200 = all rounds match, 409 = a round needs the VETO holder now, 503 = could not check.
 */
import { timingSafeEqual } from 'node:crypto';
import { RPC_URL } from '@/lib/solana/config';
import { fail, json, rankedConfigured } from '@/lib/ranked/http';
import { sendAlert, watchRounds } from '@/lib/ranked/watch';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const secrets = [process.env.CRON_SECRET, process.env.ADMIN_SECRET].filter((s): s is string => !!s && s.length >= 16);
  if (!given || !secrets.some((s) => safeEqual(given, s))) return fail(401, 'unauthorized');
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  try {
    const report = await watchRounds(RPC_URL);
    const alerted = report.urgent ? await sendAlert(report).catch(() => false) : false;
    return json({ ...report, alerted }, report.urgent ? 409 : 200);
  } catch (e) {
    console.error('prize-watch', e);
    return fail(503, 'could not check the prize program');
  }
}
