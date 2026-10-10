/** POST /api/ranked/logout-all — kills every session of the caller's wallet issued before now. */
import { authedSession } from '@/lib/ranked/auth';
import { revokeAll } from '@/lib/ranked/revocation';
import { fail, json, rankedConfigured } from '@/lib/ranked/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  try {
    const s = await authedSession(req);
    if (!s) return fail(401, 'invalid or expired session');
    await revokeAll(s.wallet);
  } catch (e) {
    console.error('ranked logout-all', e);
    return fail(503, 'logout is unavailable, try again');
  }
  return json({ ok: true });
}
