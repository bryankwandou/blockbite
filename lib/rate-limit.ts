/**
 * IP-based sliding-window rate limiter backed by Vercel KV.
 * Order of backends:
 *   1. Vercel KV, when KV_REST_API_URL + KV_REST_API_TOKEN are set.
 *   2. Postgres (Neon) table rate_hits, shared by every serverless instance. Used when KV is absent
 *      (prod has no KV_* env) and a database URL is configured.
 *   3. This instance's memory: local dev, or when the chosen shared backend throws.
 * Failure semantics are the same for every route: rateLimit() never throws and never lets a backend
 * outage block users; on error it degrades to the per-instance memory window (weaker, not absent,
 * and never fail-closed). Routes that must fail closed do so by checking `allowed`.
 */
import { neon } from '@neondatabase/serverless';

type KV = typeof import('@vercel/kv')['kv'];

// Wrapped in an object: the `kv` export is a proxy that throws on any property
// read when its env vars are missing, including the `then` check an async
// function makes on its return value.
async function getKV(): Promise<{ kv: KV } | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    const { kv } = await import('@vercel/kv');
    return { kv };
  } catch {
    return null;
  }
}

const memory = new Map<string, number[]>();

function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const hits = (memory.get(key) ?? []).filter((t) => t > now - windowMs);
  hits.push(now);
  memory.set(key, hits);
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v[v.length - 1] <= now - windowMs) memory.delete(k);
  }
  return { allowed: hits.length <= limit, remaining: Math.max(0, limit - hits.length), resetAt: now + windowMs };
}

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const TABLE = `${SCHEMA}.rate_hits`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

function dbUrl(): string | undefined {
  return process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL ?? process.env.DATABASE_URL;
}

function sql(): Sql {
  const url = dbUrl();
  if (!url) throw new Error('database is not configured');
  client ??= neon(url);
  return client;
}

async function ensure(): Promise<void> {
  const s = sql();
  await s.transaction([
    s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`),
    s.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (key text NOT NULL, at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE INDEX IF NOT EXISTS rate_hits_key_at ON ${TABLE} (key, at)`),
  ]);
}

const defaultQuery: Query = async (text, params) => {
  await (ready ??= ensure().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params as never[])) as Record<string, unknown>[];
};

/**
 * Postgres sliding window: one statement prunes this key's expired hits, records this hit and
 * counts the window, so concurrent instances share one count. Throws if the database is down.
 */
export async function pgLimit(key: string, limit: number, windowMs: number, q: Query = defaultQuery): Promise<RateLimitResult> {
  const secs = Math.max(1, Math.ceil(windowMs / 1000));
  const rows = await q(
    `WITH gone AS (DELETE FROM ${TABLE} WHERE key = $1 AND at < now() - make_interval(secs => $2)),
          ins AS (INSERT INTO ${TABLE} (key) VALUES ($1))
     SELECT (count(*) + 1)::int AS n FROM ${TABLE} WHERE key = $1 AND at >= now() - make_interval(secs => $2)`,
    [key, secs],
  );
  const n = Number(rows[0]?.n);
  if (!Number.isFinite(n)) throw new Error('rate_hits: no count returned');
  // Occasionally sweep keys nobody hits again.
  if (Math.random() < 0.01) await q(`DELETE FROM ${TABLE} WHERE at < now() - interval '1 day'`).catch(() => undefined);
  return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: Date.now() + windowMs };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
}

/**
 * Sliding-window rate limit.
 * @param key      Unique key (e.g. `rl:waitlist:1.2.3.4`)
 * @param limit    Max requests allowed in the window
 * @param windowMs Window length in milliseconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const store = await getKV();
  if (!store) {
    if (!dbUrl()) return memoryLimit(key, limit, windowMs);
    try {
      return await pgLimit(key, limit, windowMs);
    } catch {
      return memoryLimit(key, limit, windowMs);
    }
  }
  const { kv } = store;

  const now = Date.now();
  const windowStart = now - windowMs;
  const kvKey = `rl:${key}`;

  try {
    // Store each request as a timestamped member in a sorted set
    // Score = timestamp so we can trim old entries with zremrangebyscore
    const pipe = kv.pipeline();
    pipe.zadd(kvKey, { score: now, member: `${now}-${Math.random()}` });
    pipe.zremrangebyscore(kvKey, 0, windowStart);
    pipe.zcard(kvKey);
    pipe.expire(kvKey, Math.ceil(windowMs / 1000) + 5);
    const results = await pipe.exec();

    const count = (results?.[2] as number) ?? 1;
    const resetAt = now + windowMs;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch {
    // KV unreachable: count in memory rather than letting everything through.
    return memoryLimit(key, limit, windowMs);
  }
}

/** Extract best-effort IP from Next.js request headers. */
export function getIP(req: { headers: { get(k: string): string | null } }): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
