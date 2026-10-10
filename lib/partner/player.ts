/** Player-side request guard: ranked session (Bearer) + rate limit. Server only. */
import { walletFromRequestAsync } from '@/lib/ranked/auth';
import { fail } from '@/lib/admin/http';
import { getIP, rateLimit } from '@/lib/rate-limit';

export async function playerGuard(req: Request, bucket: string, limit: number): Promise<string | Response> {
  let wallet: string | null;
  try {
    wallet = await walletFromRequestAsync(req);
  } catch {
    return fail(503, 'session check unavailable, try again');
  }
  if (!wallet) return fail(401, 'sign in with your wallet first');
  const ip = getIP(req);
  const [a, b] = await Promise.all([
    rateLimit(`ptn:${bucket}:ip:${ip}`, limit * 3, 60_000),
    rateLimit(`ptn:${bucket}:w:${wallet}`, limit, 60_000),
  ]);
  if (!a.allowed || !b.allowed) return fail(429, 'too many requests, try again in a minute');
  return wallet;
}
