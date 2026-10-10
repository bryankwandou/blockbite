/** POST /api/ranked/logout — revokes the presented session token (idempotent). */
import { parseSession, bearerOf } from '@/lib/ranked/auth';
import { revokeSession } from '@/lib/ranked/revocation';
import { fail, json, rankedConfigured } from '@/lib/ranked/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!rankedConfigured()) return fail(503, 'ranked is not available');
  // Signature + expiry only: logging out an already-revoked token is a harmless no-op.
  const s = parseSession(bearerOf(req));
  if (!s) return fail(401, 'invalid or expired session');
  try {
    await revokeSession(s.sid, s.exp);
  } catch (e) {
    console.error('ranked logout', e);
    return fail(503, 'logout is unavailable, try again');
  }
  return json({ ok: true });
}
