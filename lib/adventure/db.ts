/**
 * Adventure (free mode) progress, Neon Postgres, server only. Same connection
 * as lib/ranked/db.ts.
 *
 * Before this table, free-mode results went to Vercel KV, which production
 * never had configured: progress lived only in one browser's localStorage and
 * no free player could appear on any board.
 *
 * The free board has no prizes, but it is public, so a claimed level is only
 * believed a little at a time. A wallet's level can rise by at most
 *   - MAX_GAIN per session,
 *   - one level per SECONDS_PER_LEVEL of that session's length, and
 *   - one level per SECONDS_PER_LEVEL since its last rise (so parallel
 *     sessions do not add up).
 * Each session token is accepted once (adv_sessions). Score plausibility is
 * checked by the caller (app/api/session/submit). A patient bot can still
 * climb about 4,000 levels a day on one wallet; the board says it is for fun.
 */
import { neon } from '@neondatabase/serverless';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const PROG = `${SCHEMA}.adv_progress`;
const PLAYERS = `${SCHEMA}.rk_players`;

export const MAX_GAIN = 10;
export const SECONDS_PER_LEVEL = 8;
const SESSIONS = `${SCHEMA}.adv_sessions`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

export function adventureConfigured(): boolean {
  return Boolean(process.env.blockbite_DATABASE_URL || process.env.RANKED_DATABASE_URL);
}

function sql(): Sql {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('database is not configured');
  client ??= neon(url);
  return client;
}

async function q<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  await (ready ??= (async () => {
    const s = sql();
    await s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await s.query(`CREATE TABLE IF NOT EXISTS ${PROG} (
      wallet text PRIMARY KEY,
      max_level integer NOT NULL DEFAULT 1 CHECK (max_level >= 1),
      best_score bigint NOT NULL DEFAULT 0 CHECK (best_score >= 0),
      games integer NOT NULL DEFAULT 0,
      gained_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await s.query(`CREATE INDEX IF NOT EXISTS adv_progress_board ON ${PROG} (max_level DESC, best_score DESC, updated_at)`);
    await s.query(`CREATE TABLE IF NOT EXISTS ${SESSIONS} (
      session_id text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now())`);
  })().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

/** Marks a session token used; false when it was already used. */
export async function claimSession(sessionId: string): Promise<boolean> {
  const rows = await q(`INSERT INTO ${SESSIONS} (session_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1`, [sessionId.slice(0, 80)]);
  if (Math.random() < 0.02) q(`DELETE FROM ${SESSIONS} WHERE used_at < now() - interval '2 days'`).catch(() => {});
  return rows.length === 1;
}

/**
 * Records one finished free session that lasted `playedS` seconds; returns
 * the wallet's stored level.
 */
export async function recordAdventure(wallet: string, level: number, score: number, playedS: number): Promise<number> {
  const gain = Math.max(0, Math.min(MAX_GAIN, Math.floor(playedS / SECONDS_PER_LEVEL)));
  // New level if the claim is believed: capped by this session's gain and by
  // the time since the wallet last rose.
  const next = `LEAST($2::int, t.max_level + LEAST($4::int,
      floor(extract(epoch FROM now() - coalesce(t.gained_at, 'epoch'::timestamptz)) / $5)::int))`;
  const rows = await q<{ max_level: number }>(
    `INSERT INTO ${PROG} AS t (wallet, max_level, best_score, games, gained_at)
     VALUES ($1, GREATEST(1, LEAST($2::int, 1 + $4::int)), $3::bigint, 1, now())
     ON CONFLICT (wallet) DO UPDATE SET
       max_level = GREATEST(t.max_level, ${next}),
       gained_at = CASE WHEN ${next} > t.max_level THEN now() ELSE t.gained_at END,
       best_score = GREATEST(t.best_score, $3::bigint),
       games = t.games + 1,
       updated_at = now()
     RETURNING max_level`,
    [wallet, Math.max(1, Math.floor(level)), Math.max(0, Math.floor(score)), gain, SECONDS_PER_LEVEL],
  );
  return rows[0]?.max_level ?? 1;
}

export async function adventureLevel(wallet: string): Promise<number | null> {
  const rows = await q<{ max_level: number }>(`SELECT max_level FROM ${PROG} WHERE wallet = $1`, [wallet]);
  return rows[0]?.max_level ?? null;
}

export interface AdventureRow { wallet: string; level: number; score: number; avatarId: string | null }

/** Top wallets by level reached, then best score; avatars from rk_players when that table exists. */
export async function adventureBoard(limit = 50): Promise<AdventureRow[]> {
  const order = `ORDER BY a.max_level DESC, a.best_score DESC, a.updated_at ASC LIMIT $1`;
  const cols = `a.wallet, a.max_level AS level, a.best_score::float8 AS score`;
  try {
    return await q<AdventureRow>(
      `SELECT ${cols}, p.avatar_id AS "avatarId" FROM ${PROG} a LEFT JOIN ${PLAYERS} p ON p.wallet = a.wallet ${order}`, [limit]);
  } catch {
    const rows = await q<Omit<AdventureRow, 'avatarId'>>(`SELECT ${cols} FROM ${PROG} a ${order}`, [limit]);
    return rows.map((r) => ({ ...r, avatarId: null }));
  }
}

/** 1-based rank of a wallet on the free board, or null if it has no entry. */
export async function adventureRank(wallet: string): Promise<{ rank: number; level: number; score: number } | null> {
  const rows = await q<{ rank: number; level: number; score: number }>(
    `SELECT (SELECT count(*)::int FROM ${PROG} o
              WHERE (o.max_level, o.best_score) > (a.max_level, a.best_score)) + 1 AS rank,
            a.max_level AS level, a.best_score::float8 AS score
       FROM ${PROG} a WHERE a.wallet = $1`, [wallet]);
  return rows[0] ?? null;
}
