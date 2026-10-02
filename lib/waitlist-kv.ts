/**
 * Waitlist persistence via Vercel KV (same KV instance as leaderboard).
 * KV is the primary store — always available when deployed to Vercel.
 * Supabase is kept as a secondary mirror.
 */

const KV_EMAIL_SET = 'bb:waitlist:emails';
const KV_COUNT_KEY = 'bb:waitlist:count';

async function getKV() {
  try {
    const { kv } = await import('@vercel/kv');
    return kv;
  } catch {
    return null;
  }
}

/**
 * Add an email to the waitlist.
 * Returns 'inserted' | 'duplicate' | 'error'.
 */
export async function kvAddEmail(email: string): Promise<'inserted' | 'duplicate' | 'error'> {
  try {
    const kv = await getKV();
    if (!kv) return 'error';
    // SADD returns 1 if new, 0 if already a member
    const added = await kv.sadd(KV_EMAIL_SET, email);
    if (added === 0) return 'duplicate';
    await kv.incr(KV_COUNT_KEY);
    return 'inserted';
  } catch {
    return 'error';
  }
}

/**
 * Get the total waitlist count.
 * Uses SCARD (set cardinality) as the authoritative count — it can never drift
 * from the actual email set, unlike an incrementing counter.
 * Returns null if KV is unavailable.
 */
export async function kvGetCount(): Promise<number | null> {
  try {
    const kv = await getKV();
    if (!kv) return null;
    // SCARD is always accurate — the incr counter drifts when emails bypass KV
    const size = await kv.scard(KV_EMAIL_SET);
    if (typeof size === 'number') {
      // Sync counter so it matches the set (repairs any previous drift)
      await kv.set(KV_COUNT_KEY, size);
      return size;
    }
    // If SCARD fails, fall back to the plain counter
    const raw = await kv.get<number>(KV_COUNT_KEY);
    if (raw !== null && raw !== undefined) {
      return typeof raw === 'number' ? raw : parseInt(String(raw));
    }
    return 0;
  } catch {
    return null;
  }
}

/**
 * Sync KV counter to a known external count (e.g. Supabase).
 * Always overwrites so KV stays aligned with the database truth.
 */
export async function kvSeedFromExternal(externalCount: number): Promise<void> {
  try {
    const kv = await getKV();
    if (!kv || externalCount <= 0) return;
    await kv.set(KV_COUNT_KEY, externalCount);
  } catch { /* non-critical */ }
}
