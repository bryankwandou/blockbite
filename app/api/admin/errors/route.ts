/**
 * POST (public, rate limited): { message, stack?, path?, build? } → stored in adm_errors.
 * GET (admin): grouped errors.
 */
import { createHash } from 'node:crypto';
import { T, dbUrl, q } from '@/lib/admin/db';
import { fail, json, requireRole } from '@/lib/admin/http';
import { readJson } from '@/lib/http/body';
import { limit } from '@/lib/versus/limit';
import { errors } from '@/lib/admin/stats';

export const dynamic = 'force-dynamic';

const MAX_PER_DAY = 5000;

// Per-instance limiter: 10 reports / minute / visitor, 300 / minute overall.
const hits = new Map<string, { n: number; reset: number }>();
let overall = { n: 0, reset: 0 };
function limited(key: string, now = Date.now()): boolean {
  if (now > overall.reset) overall = { n: 0, reset: now + 60_000 };
  if (++overall.n > 300) return true;
  const h = hits.get(key);
  if (!h || now > h.reset) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { n: 1, reset: now + 60_000 });
    return false;
  }
  return ++h.n > 10;
}

export async function POST(req: Request) {
  if (!dbUrl()) return fail(503, 'not configured');
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const salt = process.env.ADMIN_SESSION_SECRET ?? process.env.RANKED_SECRET ?? 'blockbite';
  const visitor = createHash('sha256').update(`${ip}|${new Date().toISOString().slice(0, 10)}|${salt}`).digest('hex').slice(0, 24);
  if (limited(visitor)) return fail(429, 'too many reports');
  // Shared across instances (KV, else the Postgres counter): per visitor, and one global ceiling.
  if (!(await limit(`adm-err:${visitor}`, 10, 60_000)) || !(await limit('adm-err:all', 300, 60_000))) return fail(429, 'too many reports');
  const b = await readJson(req, 4 * 1024);
  if (b instanceof Response) return b;
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 300) : '';
  if (!message) return fail(400, 'message is required');
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);
  // The table cannot grow without bound: past MAX_PER_DAY rows in 24 h the insert is skipped
  // (202, so the reporter does not retry); rows older than 30 days (the admin view's window)
  // are pruned on ~2% of writes.
  const ins = await q<{ id: number }>(
    `INSERT INTO ${T.errors} (message, stack, path, build, visitor)
     SELECT $1, $2, $3, $4, $5 WHERE (SELECT count(*) FROM ${T.errors} WHERE at > now() - interval '1 day') < ${MAX_PER_DAY}
     RETURNING id`,
    [message, str(b.stack, 1200), str(b.path, 200), str(b.build, 64), visitor]);
  if (Math.random() < 0.02) await q(`DELETE FROM ${T.errors} WHERE at < now() - interval '30 days'`).catch(() => {});
  return ins.length ? json({ ok: true }, 201) : json({ ok: false, dropped: true }, 202);
}

export async function GET(req: Request) {
  const w = requireRole(req, 'admin');
  if (w instanceof Response) return w;
  return json(await errors());
}
