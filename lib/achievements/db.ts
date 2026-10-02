/**
 * Achievement storage (Neon Postgres, server only). Same connection as
 * lib/ranked/db.ts. Only reached ids + time are stored, never on-chain:
 * a transaction per achievement would cost fees and add nothing the player
 * needs, since the stats behind them are off-chain already.
 */
import { neon } from '@neondatabase/serverless';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const UNLOCKS = `${SCHEMA}.ach_unlocks`;
const RUNS = `${SCHEMA}.rk_runs`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

export function achievementsConfigured(): boolean {
  return Boolean(process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL);
}

function sql(): Sql {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('database is not configured');
  client ??= neon(url);
  return client;
}

async function q<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  await (ready ??= sql()
    .query(`CREATE TABLE IF NOT EXISTS ${UNLOCKS} (
      wallet text NOT NULL,
      id text NOT NULL,
      unlocked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet, id))`)
    .then(() => undefined)
    .catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

export interface Unlock { id: string; at: string }

export async function unlocksOf(wallet: string): Promise<Unlock[]> {
  return q<Unlock>(`SELECT id, unlocked_at AS at FROM ${UNLOCKS} WHERE wallet = $1 ORDER BY unlocked_at, id`, [wallet]);
}

/** Inserts ids not yet stored; returns the newly added ones. */
export async function addUnlocks(wallet: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await q<{ id: string }>(
    `INSERT INTO ${UNLOCKS} (wallet, id) SELECT $1, unnest($2::text[])
     ON CONFLICT DO NOTHING RETURNING id`, [wallet, ids]);
  return rows.map((r) => r.id);
}

/** Ranked stats the server can prove from rk_runs: days played and top-10 days. */
export async function rankedStats(wallet: string): Promise<{ ranked_days: number; top10: number }> {
  try {
    const rows = await q<{ days: number; top10: number }>(
      `WITH best AS (
         SELECT wallet, day, max(score) AS s FROM ${RUNS} WHERE score > 0 GROUP BY wallet, day),
       ranked AS (
         SELECT wallet, day, rank() OVER (PARTITION BY day ORDER BY s DESC) AS r FROM best
         WHERE day IN (SELECT day FROM best WHERE wallet = $1))
       SELECT count(*)::int AS days, count(*) FILTER (WHERE r <= 10)::int AS top10
       FROM ranked WHERE wallet = $1`, [wallet]);
    return { ranked_days: rows[0]?.days ?? 0, top10: rows[0]?.top10 ?? 0 };
  } catch {
    return { ranked_days: 0, top10: 0 };
  }
}
