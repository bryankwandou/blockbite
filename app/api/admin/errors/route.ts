/**
 * POST (public, rate limited): { message, stack?, path?, build? } → stored in adm_errors.
 * GET (admin): grouped errors.
 */
import { createHash } from 'node:crypto';
import { T, dbUrl, q } from '@/lib/admin/db';
import { body, fail, json, requireRole } from '@/lib/admin/http';
import { errors } from '@/lib/admin/stats';

export const dynamic = 'force-dynamic';

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
  const b = await body(req);
  const message = typeof b?.message === 'string' ? b.message.trim().slice(0, 300) : '';
  if (!message) return fail(400, 'message is required');
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);
  await q(`INSERT INTO ${T.errors} (message, stack, path, build, visitor) VALUES ($1, $2, $3, $4, $5)`,
    [message, str(b?.stack, 1200), str(b?.path, 200), str(b?.build, 64), visitor]);
  return json({ ok: true }, 201);
}

export async function GET(req: Request) {
  const w = requireRole(req, 'admin');
  if (w instanceof Response) return w;
  return json(await errors());
}
