/**
 * Leaderboard store — double database:
 *   Layer 1 (KV hash)        : best score per wallet  → fast O(1) lookup
 *   Layer 2 (KV sorted sets) : period leaderboards    → Monthly / Daily / All-Time tabs
 *   Layer 3 (txSignature)    : Solana memo proof      → on-chain audit trail
 *
 * Sorted set keys:
 *   bb:lb:all            – all-time best score per wallet
 *   bb:lb:YYYY-MM        – monthly best score per wallet
 *   bb:lb:YYYY-MM-DD     – daily best score per wallet
 *
 * Metadata hash:
 *   bb:lb:meta           – wallet → full LeaderboardEntry JSON
 *
 * Ticket counter hash:
 *   bb:tickets           – wallet → int (total game sessions = tickets used)
 */

export interface LeaderboardEntry {
  walletAddress: string;
  score: number;          // best (highest) single-game score
  level: number;
  submittedAt: number;
  txSignature?: string;   // Solana memo tx — blockchain proof layer
  ticketsUsed?: number;   // total game sessions (tickets spent) — tracked going forward
}

// In-memory cache (warm-instance, per serverless instance)
export const LEADERBOARD = new Map<string, LeaderboardEntry>();

async function getKV() {
  try {
    const { kv } = await import('@vercel/kv');
    return kv;
  } catch {
    return null;
  }
}

const LB_HASH_KEY    = 'blockbite:leaderboard'; // legacy hash (kept for compat + recovery)
const LB_META_KEY    = 'bb:lb:meta';            // new meta hash
const LB_TICKETS_KEY = 'bb:tickets';            // hash: wallet → ticket count

function periodKeys(ts: number) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    all:     'bb:lb:all',
    monthly: `bb:lb:${y}-${m}`,
    daily:   `bb:lb:${y}-${m}-${day}`,
  };
}

/** Persist a score to all storage layers. Always increments ticket counter. */
export async function recordScore(entry: LeaderboardEntry): Promise<void> {
  const existing = LEADERBOARD.get(entry.walletAddress);
  const isBest = !existing || existing.score < entry.score;

  // Update in-memory best score cache
  if (isBest) {
    LEADERBOARD.set(entry.walletAddress, entry);
  }

  const kv = await getKV();
  if (!kv) return;

  const keys = periodKeys(entry.submittedAt);

  await Promise.allSettled([
    // Layer 1: best score hash (legacy compat)
    isBest
      ? kv.hset(LB_HASH_KEY, { [entry.walletAddress]: JSON.stringify(entry) })
      : Promise.resolve(),

    // Layer 2a: all-time sorted set (GT = only update if new score is higher)
    kv.zadd(keys.all,     { gt: true }, { score: entry.score, member: entry.walletAddress }),

    // Layer 2b: monthly sorted set
    kv.zadd(keys.monthly, { gt: true }, { score: entry.score, member: entry.walletAddress }),

    // Layer 2c: daily sorted set
    kv.zadd(keys.daily,   { gt: true }, { score: entry.score, member: entry.walletAddress }),

    // Layer 3: metadata hash (always update to latest best)
    isBest
      ? kv.hset(LB_META_KEY, { [entry.walletAddress]: JSON.stringify(entry) })
      : Promise.resolve(),

    // Ticket counter: increment regardless of whether score is best
    kv.hincrby(LB_TICKETS_KEY, entry.walletAddress, 1),
  ]);
}

/** Load persisted best scores from KV into in-memory cache (cold start). */
export async function hydrateFromKV(): Promise<void> {
  if (LEADERBOARD.size > 0) return;
  const kv = await getKV();
  if (!kv) return;
  try {
    const raw = await kv.hgetall<Record<string, string>>(LB_HASH_KEY);
    if (!raw) return;
    for (const [wallet, json] of Object.entries(raw)) {
      try {
        LEADERBOARD.set(wallet, JSON.parse(json));
      } catch { /* skip malformed */ }
    }
  } catch { /* KV unavailable */ }
}

/**
 * Read top-N scores for a given period directly from sorted sets.
 * Falls back to legacy hash when sorted set is empty (e.g. after zadd bug).
 */
export async function getTopScores(
  period: 'all' | 'monthly' | 'daily',
  limit = 20,
): Promise<LeaderboardEntry[]> {
  const kv = await getKV();

  if (!kv) {
    // No KV — in-memory fallback (all-time only)
    return [...LEADERBOARD.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const keys = periodKeys(Date.now());
  const setKey = period === 'monthly' ? keys.monthly
    : period === 'daily'   ? keys.daily
    : keys.all;

  try {
    // ZRANGE ... REV LIMIT — top N by score descending
    let wallets = await kv.zrange(setKey, 0, limit - 1, { rev: true }) as string[];

    // ── RECOVERY FALLBACK ──────────────────────────────────────────────────
    // If the period sorted set is empty (all scores were in legacy hash before
    // the zadd bug fix), fall back gracefully:
    //   • monthly/daily → try all-time sorted set first
    //   • still empty   → read from legacy hash + fire background recovery
    if (!wallets || wallets.length === 0) {
      if (period !== 'all') {
        wallets = await kv.zrange(keys.all, 0, limit - 1, { rev: true }) as string[] ?? [];
      }
      if (!wallets || wallets.length === 0) {
        // Last resort: legacy hash (all historical data lives here).
        // Also fire background recovery so the NEXT request hits sorted sets.
        _backgroundRecover(kv);
        return _topFromLegacyHash(kv, limit);
      }
    }

    // Bulk-fetch metadata and ticket counts in parallel
    const [metaRaw, ticketRaw] = await Promise.all([
      kv.hmget(LB_META_KEY, ...wallets),
      kv.hmget(LB_TICKETS_KEY, ...wallets),
    ]);

    return wallets.map((wallet, i) => {
      try {
        const rawMeta = Array.isArray(metaRaw)
          ? metaRaw[i]
          : (metaRaw as Record<string, unknown>)?.[wallet];
        if (!rawMeta) return null;
        const parsed: LeaderboardEntry =
          typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;

        const rawTickets = Array.isArray(ticketRaw)
          ? ticketRaw[i]
          : (ticketRaw as Record<string, unknown>)?.[wallet];
        parsed.ticketsUsed = rawTickets ? Number(rawTickets) : undefined;

        return parsed;
      } catch {
        return null;
      }
    }).filter(Boolean) as LeaderboardEntry[];
  } catch {
    // Sorted set unavailable — fall back to legacy hash
    await hydrateFromKV();
    return [...LEADERBOARD.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/** Read top-N entries directly from legacy hash (recovery path). */
async function _topFromLegacyHash(kv: Awaited<ReturnType<typeof getKV>>, limit: number): Promise<LeaderboardEntry[]> {
  if (!kv) return [];
  try {
    const [legacyRaw, metaRaw, ticketRaw] = await Promise.all([
      kv.hgetall<Record<string, unknown>>(LB_HASH_KEY),
      kv.hgetall<Record<string, unknown>>(LB_META_KEY),
      kv.hgetall<Record<string, unknown>>(LB_TICKETS_KEY),
    ]);

    const merged = new Map<string, LeaderboardEntry>();

    const tryParse = (v: unknown): LeaderboardEntry | null => {
      if (!v) return null;
      try {
        const obj = typeof v === 'string' ? JSON.parse(v) : v;
        if (obj && typeof obj.score === 'number') return obj as LeaderboardEntry;
      } catch { /* skip */ }
      return null;
    };

    for (const [w, v] of Object.entries(legacyRaw ?? {})) {
      const e = tryParse(v);
      if (e) merged.set(w, { ...e, walletAddress: w });
    }
    for (const [w, v] of Object.entries(metaRaw ?? {})) {
      const e = tryParse(v);
      if (e) {
        const ex = merged.get(w);
        if (!ex || e.score >= ex.score) merged.set(w, { ...e, walletAddress: w });
      }
    }

    // Attach ticket counts
    for (const [w, v] of Object.entries(ticketRaw ?? {})) {
      const entry = merged.get(w);
      if (entry) entry.ticketsUsed = Number(v) || 1;
    }

    return [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// Guard: only fire one background recovery per serverless instance lifetime.
let _recovering = false;

/**
 * Fire-and-forget background recovery. Does nothing if already running.
 * Called automatically when sorted sets are empty but legacy hash has data.
 */
function _backgroundRecover(kv: Awaited<ReturnType<typeof getKV>>): void {
  if (_recovering || !kv) return;
  _recovering = true;
  recoverLegacyData().finally(() => { _recovering = false; });
}

/**
 * Migrate all legacy hash data into sorted sets + ensure ticket counts exist.
 * Safe to call multiple times — uses GT flag so no score is downgraded.
 * Returns { wallets, errors } counts.
 */
export async function recoverLegacyData(): Promise<{ wallets: number; errors: number }> {
  const kv = await getKV();
  if (!kv) return { wallets: 0, errors: 0 };

  const [legacyRaw, metaRaw] = await Promise.all([
    kv.hgetall<Record<string, unknown>>(LB_HASH_KEY),
    kv.hgetall<Record<string, unknown>>(LB_META_KEY),
  ]);

  if (!legacyRaw && !metaRaw) return { wallets: 0, errors: 0 };

  const tryParse = (v: unknown): LeaderboardEntry | null => {
    if (!v) return null;
    try {
      const obj = typeof v === 'string' ? JSON.parse(v) : v;
      return (obj && typeof obj.score === 'number') ? (obj as LeaderboardEntry) : null;
    } catch { return null; }
  };

  const merged = new Map<string, LeaderboardEntry>();
  for (const [w, v] of Object.entries(legacyRaw ?? {})) {
    const e = tryParse(v);
    if (e) merged.set(w, { ...e, walletAddress: w });
  }
  for (const [w, v] of Object.entries(metaRaw ?? {})) {
    const e = tryParse(v);
    if (e) {
      const ex = merged.get(w);
      if (!ex || e.score >= ex.score) merged.set(w, { ...e, walletAddress: w });
    }
  }

  const entries = [...merged.values()];
  let errors = 0;

  // Process in batches of 50 to avoid timeout
  const BATCH = 50;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const ops = batch.flatMap(e => {
      const keys = periodKeys(e.submittedAt || Date.now());
      return [
        kv.zadd(keys.all,     { gt: true }, { score: e.score, member: e.walletAddress }),
        kv.zadd(keys.monthly, { gt: true }, { score: e.score, member: e.walletAddress }),
        kv.zadd(keys.daily,   { gt: true }, { score: e.score, member: e.walletAddress }),
        kv.hset(LB_META_KEY,  { [e.walletAddress]: JSON.stringify(e) }),
      ];
    });

    const results = await Promise.allSettled(ops);
    errors += results.filter(r => r.status === 'rejected').length;
  }

  // Seed minimum ticket count = 1 for all recovered wallets that have no count yet
  const walletList = entries.map(e => e.walletAddress);
  if (walletList.length > 0) {
    try {
      const existingCounts = await kv.hmget(LB_TICKETS_KEY, ...walletList);
      const seedMap: Record<string, number> = {};
      walletList.forEach((w, i) => {
        const v = Array.isArray(existingCounts) ? existingCounts[i] : (existingCounts as Record<string,unknown>)?.[w];
        if (v == null || v === 0) seedMap[w] = 1;
      });
      if (Object.keys(seedMap).length > 0) {
        await kv.hset(LB_TICKETS_KEY, seedMap);
      }
    } catch { errors++; }
  }

  return { wallets: entries.length, errors };
}
