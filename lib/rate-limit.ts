/**
 * IP-based sliding-window rate limiter backed by Vercel KV.
 * Without KV (dev, or env not set) it counts in this server instance's memory,
 * which still limits a single client hitting one instance.
 */

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
  if (!store) return memoryLimit(key, limit, windowMs);
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
