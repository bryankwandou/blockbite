/**
 * POST /api/achievements/sync { wallet, stats }
 *      Authorization: Bearer <session token from POST /api/ranked/auth>
 *      → { wallet, added: string[], unlocks: [{ id, at }], verified: string[] }
 *
 * The server recomputes what it can prove and ignores the client's number:
 *   level        from the profile store (lib/store.ts, written by session submit)
 *   ranked_days, top10   from the ranked runs table
 * The other stats (lines, combos, …) only exist on the device, so they are
 * taken as sent, clamped to whole numbers in range.
 */
import { isWallet } from '@/lib/ranked/auth';
import { body, fail, json, requireWallet } from '@/lib/ranked/http';
import { getIP, rateLimit } from '@/lib/rate-limit';
import { getUser } from '@/lib/store';
import { CATEGORIES, evaluate, type Category, type Stats } from '@/lib/achievements/catalog';
import { achievementsConfigured, addUnlocks, rankedStats, unlocksOf } from '@/lib/achievements/db';

export const dynamic = 'force-dynamic';

const VERIFIED: Category[] = ['level', 'ranked_days', 'top10'];

export async function POST(req: Request) {
  if (!achievementsConfigured()) return fail(503, 'achievements are not available');
  const signedIn = await requireWallet(req);
  if (typeof signedIn !== 'string') return fail(401, 'sign in with your wallet first', { signIn: '/api/ranked/auth' });
  const b = await body(req);
  if (!b || !isWallet(b.wallet)) return fail(400, 'bad wallet');
  if (b.wallet !== signedIn) return fail(403, 'signed in as a different wallet');
  const rl = await rateLimit(`ach:${getIP(req)}`, 60, 60 * 60_000).catch(() => null);
  if (rl && !rl.allowed) return fail(429, 'too many syncs, try again later');

  const sent = (b.stats && typeof b.stats === 'object' ? b.stats : {}) as Record<string, unknown>;
  const stats: Stats = {};
  for (const c of CATEGORIES) {
    if (VERIFIED.includes(c)) continue;
    const v = sent[c];
    if (typeof v === 'number' && Number.isFinite(v)) stats[c] = Math.max(0, Math.min(1e12, Math.floor(v)));
  }
  const [user, ranked] = await Promise.all([getUser(signedIn).catch(() => null), rankedStats(signedIn)]);
  stats.level = user?.currentLevel ?? 0;
  stats.ranked_days = ranked.ranked_days;
  stats.top10 = ranked.top10;

  const added = await addUnlocks(signedIn, evaluate(stats));
  return json({ wallet: signedIn, added, unlocks: await unlocksOf(signedIn), verified: VERIFIED });
}
