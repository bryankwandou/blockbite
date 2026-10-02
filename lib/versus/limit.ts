/**
 * Rate limit for the challenge API. Uses lib/rate-limit (Vercel KV) when KV is
 * configured; otherwise (or if it throws) a per-instance in-memory window.
 */
import { rateLimit } from '@/lib/rate-limit';

const hits: Map<string, number[]> = ((globalThis as { __bbVsRl?: Map<string, number[]> }).__bbVsRl ??= new Map<string, number[]>());

export async function limit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try { return (await rateLimit(key, max, windowMs)).allowed; } catch { /* fall through */ }
  }
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length <= max;
}
