/**
 * Analytics stored in this company's own Neon database.
 *
 * Replaces the previous Supabase Storage implementation, which was shared by
 * all three BlockBite entities. Page views and wallet connections recorded
 * from the separation onward belong to this company alone.
 *
 * The final combined snapshot taken before separation is kept in
 * `analytics_snapshot` and reported separately as an inherited baseline, so
 * joint history is never presented as this entity's own traffic.
 *
 * Uses Neon's SQL-over-HTTP endpoint — no driver dependency.
 */

/**
 * Resolve the connection string for the TRAFFIC ANALYTICS database.
 *
 * Analytics deliberately stays on the database the Vercel Neon integration
 * provisioned for this project (`blockbite_DATABASE_URL`). Game state — player
 * profiles, scores, tickets — lives in a separate database resolved by
 * lib/neon.ts, which prefers the plain `DATABASE_URL`.
 *
 * The two are kept apart on purpose: the analytics database carries the
 * pre-separation traffic history and must not be written to by gameplay. That
 * is why this resolver checks the integration-prefixed name FIRST and the
 * order differs from lib/neon.ts — the difference is the separation.
 */
function resolveConn(): string {
  // Order matters: production has been pointing analytics at DATABASE_URL, and
  // NEON_SQL_HOST below is the matching host for it. Putting any other database
  // ahead of it would silently relocate the traffic history to an empty one.
  const candidates = [
    process.env.ANALYTICS_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.blockbite_DATABASE_URL,
  ];
  return candidates.find((v) => typeof v === 'string' && v.length > 0) ?? '';
}

const CONN = resolveConn();
const HOST = process.env.NEON_SQL_HOST ?? (CONN.match(/@([^/]+)\//)?.[1] ?? '');

export function neonReady(): boolean {
  return Boolean(CONN && HOST);
}

async function sql<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch(`https://${HOST}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': CONN,
    },
    body: JSON.stringify({ query, params }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`neon:${res.status}`);
  return (await res.json()).rows as T[];
}

/** Create the analytics tables once. Safe to call on every request. */
async function ensure(): Promise<void> {
  await sql(`CREATE TABLE IF NOT EXISTS page_view (
    id      BIGSERIAL PRIMARY KEY,
    path    TEXT        NOT NULL,
    sid     TEXT,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await sql(`CREATE TABLE IF NOT EXISTS wallet_connect (
    id      BIGSERIAL PRIMARY KEY,
    anon    TEXT,
    wallet  TEXT        NOT NULL,
    path    TEXT,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

export async function neonTrackView(path: string, sid: string): Promise<void> {
  if (!neonReady()) return;
  try {
    await ensure();
    await sql('INSERT INTO page_view (path, sid) VALUES ($1, $2)', [path, sid]);
  } catch {
    /* tracking must never break a page render */
  }
}

export async function neonTrackWallet(
  anon: string,
  wallet: string,
  path: string,
): Promise<void> {
  if (!neonReady()) return;
  try {
    await ensure();
    await sql('INSERT INTO wallet_connect (anon, wallet, path) VALUES ($1, $2, $3)', [
      anon,
      wallet,
      path,
    ]);
  } catch {
    /* ignore */
  }
}

export type PageStat = { path: string; views: number; sessions: number };
export type DayStat = { date: string; views: number; visitors: number };

export async function neonPageStats(): Promise<PageStat[]> {
  if (!neonReady()) return [];
  try {
    await ensure();
    return await sql<PageStat>(
      `SELECT path,
              count(*)::int              AS views,
              count(DISTINCT sid)::int   AS sessions
       FROM page_view GROUP BY path ORDER BY views DESC LIMIT 20`,
    );
  } catch {
    return [];
  }
}

export type Totals = {
  ownViews: number;
  ownVisitors: number;
  today: number;
  byDay: DayStat[];
  inheritedViews: number;
  inheritedVisitors: number;
  capturedAt: string | null;
};

export async function neonTotals(): Promise<Totals | null> {
  if (!neonReady()) return null;
  try {
    await ensure();
    const [own] = await sql<{ v: number; u: number; t: number }>(
      `SELECT count(*)::int                                            AS v,
              count(DISTINCT sid)::int                                 AS u,
              count(*) FILTER (WHERE seen_at::date = CURRENT_DATE)::int AS t
       FROM page_view`,
    );
    const days = await sql<{ d: string; v: number; u: number }>(
      `SELECT to_char(seen_at::date,'YYYY-MM-DD') AS d,
              count(*)::int                        AS v,
              count(DISTINCT sid)::int             AS u
       FROM page_view
       WHERE seen_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY 1`,
    );
    const map = new Map(days.map(r => [r.d, r]));
    const byDay: DayStat[] = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date();
      dt.setDate(dt.getDate() - (6 - i));
      const date = dt.toISOString().slice(0, 10);
      const r = map.get(date);
      return { date, views: r?.v ?? 0, visitors: r?.u ?? 0 };
    });

    // Inherited joint history — reported apart from own traffic.
    let inheritedViews = 0;
    let inheritedVisitors = 0;
    let capturedAt: string | null = null;
    try {
      const [snap] = await sql<{ v: number | null; u: number | null; captured_at: string }>(
        `SELECT (payload->'totalStats'->>'totalViews')::int     AS v,
                (payload->'totalStats'->>'uniqueVisitors')::int AS u,
                captured_at
         FROM analytics_snapshot ORDER BY id DESC LIMIT 1`,
      );
      if (snap) {
        inheritedViews = snap.v ?? 0;
        inheritedVisitors = snap.u ?? 0;
        capturedAt = snap.captured_at ?? null;
      }
    } catch {
      /* no snapshot — baseline stays zero */
    }

    return {
      ownViews: own?.v ?? 0,
      ownVisitors: own?.u ?? 0,
      today: own?.t ?? 0,
      byDay,
      inheritedViews,
      inheritedVisitors,
      capturedAt,
    };
  } catch {
    return null;
  }
}

export type WalletStats = {
  total: number;
  unique: number;
  today: number;
  byWallet: Array<{ name: string; count: number }>;
};

export async function neonWalletStats(): Promise<WalletStats> {
  const empty: WalletStats = { total: 0, unique: 0, today: 0, byWallet: [] };
  if (!neonReady()) return empty;
  try {
    await ensure();
    const rows = await sql<{ name: string; count: number }>(
      `SELECT wallet AS name, count(*)::int AS count
       FROM wallet_connect GROUP BY wallet ORDER BY count DESC`,
    );
    const [agg] = await sql<{ t: number; u: number }>(
      `SELECT count(*) FILTER (WHERE seen_at::date = CURRENT_DATE)::int AS t,
              count(DISTINCT anon)::int                                 AS u
       FROM wallet_connect`,
    );
    return {
      total: rows.reduce((a, b) => a + b.count, 0),
      unique: agg?.u ?? 0,
      today: agg?.t ?? 0,
      byWallet: rows,
    };
  } catch {
    return empty;
  }
}
