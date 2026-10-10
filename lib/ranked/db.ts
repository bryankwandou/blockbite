/**
 * Ranked storage (Neon Postgres, server only).
 *
 * Every write that must not race is a single SQL statement, so Postgres
 * makes it atomic: a credit is spent and an attempt is created together, and
 * a run only advances from the exact move count the client last saw.
 */

import { neon } from '@neondatabase/serverless';
import { MONTHLY_BEST_DAYS } from './config';
import type { RankedState } from './rules';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const T = {
  credits: `${SCHEMA}.rk_credits`,
  purchases: `${SCHEMA}.rk_purchases`,
  runs: `${SCHEMA}.rk_runs`,
  players: `${SCHEMA}.rk_players`,
  rounds: `${SCHEMA}.rk_rounds`,
};

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

function sql(): Sql {
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('Ranked database is not configured');
  client ??= neon(url);
  return client;
}

async function q<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  // A failed migration is retried by the next query instead of failing every
  // later query on this instance.
  await (ready ??= migrate().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

/**
 * Idempotent schema setup, sent as one HTTP round trip. New columns are
 * added with ADD COLUMN IF NOT EXISTS so existing tables upgrade in place.
 */
async function migrate(): Promise<void> {
  const s = sql();
  await s.transaction([
    s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.credits} (
      wallet text PRIMARY KEY,
      n integer NOT NULL DEFAULT 0 CHECK (n >= 0),
      updated_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.purchases} (
      sig text PRIMARY KEY,
      wallet text NOT NULL,
      tickets integer NOT NULL,
      vault_amount bigint NOT NULL,
      referral_account text,
      created_at timestamptz NOT NULL DEFAULT now())`),
    // Prize pools are cut from each UTC day's vault inflow.
    s.query(`CREATE INDEX IF NOT EXISTS rk_purchases_created ON ${T.purchases} (created_at)`),
    // On-chain time of the purchase; its UTC day is the pool day (older rows: created_at).
    s.query(`ALTER TABLE ${T.purchases} ADD COLUMN IF NOT EXISTS block_time timestamptz`),
    s.query(`CREATE INDEX IF NOT EXISTS rk_purchases_pool_time ON ${T.purchases} ((coalesce(block_time, created_at)))`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.runs} (
      id text PRIMARY KEY,
      wallet text NOT NULL,
      day date NOT NULL,
      attempt smallint NOT NULL CHECK (attempt BETWEEN 1 AND 3),
      state jsonb NOT NULL,
      log jsonb NOT NULL DEFAULT '[]'::jsonb,
      score bigint NOT NULL DEFAULT 0,
      moves integer NOT NULL DEFAULT 0,
      over boolean NOT NULL DEFAULT false,
      flags integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_step_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (wallet, day, attempt))`),
    s.query(`CREATE INDEX IF NOT EXISTS rk_runs_day_score ON ${T.runs} (day, score DESC)`),
    // One row per wallet that has saved a profile setting.
    s.query(`CREATE TABLE IF NOT EXISTS ${T.players} (
      wallet text PRIMARY KEY,
      updated_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`ALTER TABLE ${T.players} ADD COLUMN IF NOT EXISTS avatar_id text
      CONSTRAINT rk_players_avatar_slug CHECK (avatar_id ~ '^[a-z0-9-]{1,40}$')`),
    // Prize rounds exactly as posted on-chain; proofs are served from these leaves.
    s.query(`CREATE TABLE IF NOT EXISTS ${T.rounds} (
      round_id bigint PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('day', 'month')),
      period text NOT NULL,
      root text NOT NULL,
      total bigint NOT NULL CHECK (total > 0),
      leaves jsonb NOT NULL,
      posted_sig text,
      posted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now())`),
  ]);
}

// ── Credits ─────────────────────────────────────────────────────────

/**
 * Records a verified purchase and adds its tickets, once per signature.
 * Returns false if the signature was already credited.
 */
export async function creditPurchase(p: {
  sig: string; wallet: string; tickets: number; vaultAmount: bigint; referralAccount: string | null; blockTimeMs: number;
}): Promise<boolean> {
  const rows = await q(
    `WITH p AS (
       INSERT INTO ${T.purchases} (sig, wallet, tickets, vault_amount, referral_account, block_time)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6::float8 / 1000)) ON CONFLICT (sig) DO NOTHING RETURNING wallet, tickets)
     INSERT INTO ${T.credits} (wallet, n) SELECT wallet, tickets FROM p
     ON CONFLICT (wallet) DO UPDATE SET n = ${T.credits}.n + EXCLUDED.n, updated_at = now()
     RETURNING n`,
    [p.sig, p.wallet, p.tickets, p.vaultAmount.toString(), p.referralAccount, p.blockTimeMs],
  );
  return rows.length === 1;
}

export async function getCredits(wallet: string): Promise<number> {
  const rows = await q<{ n: number }>(`SELECT n FROM ${T.credits} WHERE wallet = $1`, [wallet]);
  return rows[0]?.n ?? 0;
}

/**
 * The referrer recorded for `wallet` in lib/referrals (ref_signups), read
 * only; null if none or the table does not exist yet.
 */
export async function referrerOf(wallet: string): Promise<string | null> {
  const ref = `${SCHEMA}.ref_signups`;
  if (!(await q<{ ok: boolean }>(`SELECT to_regclass('${ref}') IS NOT NULL AS ok`))[0]?.ok) return null;
  const rows = await q<{ referrer: string }>(`SELECT referrer FROM ${ref} WHERE referred = $1`, [wallet]);
  return rows[0]?.referrer ?? null;
}

// ── Runs ────────────────────────────────────────────────────────────

export interface RunRow {
  id: string;
  wallet: string;
  day: string;
  attempt: number;
  state: RankedState;
  score: number;
  moves: number;
  over: boolean;
  flags: number;
  last_step_ms: number;
}

const RUN_COLS = `id, wallet, to_char(day, 'YYYY-MM-DD') AS day, attempt, state, score::float8 AS score,
  moves, over, flags, (extract(epoch FROM last_step_at) * 1000)::float8 AS last_step_ms`;

export type StartResult = { ok: true; attempt: number } | { ok: false; reason: 'no_credits' | 'max_attempts' | 'busy' };

/** Spends one credit and opens attempt N+1 for (wallet, day) in one statement. */
export async function startRun(id: string, wallet: string, day: string, state: RankedState): Promise<StartResult> {
  try {
    const rows = await q<{ attempt: number }>(
      `WITH c AS (
         UPDATE ${T.credits} SET n = n - 1, updated_at = now()
         WHERE wallet = $2 AND n > 0 RETURNING wallet)
       INSERT INTO ${T.runs} (id, wallet, day, attempt, state)
       SELECT $1, $2, $3::date,
         (SELECT count(*) + 1 FROM ${T.runs} WHERE wallet = $2 AND day = $3::date), $4::jsonb
       FROM c RETURNING attempt`,
      [id, wallet, day, JSON.stringify(state)],
    );
    return rows.length === 1 ? { ok: true, attempt: rows[0].attempt } : { ok: false, reason: 'no_credits' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23514') return { ok: false, reason: 'max_attempts' }; // CHECK attempt <= 3
    if (code === '23505') return { ok: false, reason: 'busy' }; // concurrent start
    throw e;
  }
}

export async function attemptsOn(wallet: string, day: string): Promise<number> {
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${T.runs} WHERE wallet = $1 AND day = $2::date`, [wallet, day]);
  return rows[0]?.n ?? 0;
}

export async function getRun(id: string): Promise<RunRow | null> {
  if (id.includes('\x00')) return null; // Postgres refuses NUL in text (would be a 500)
  const rows = await q<RunRow>(`SELECT ${RUN_COLS} FROM ${T.runs} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function runsOf(wallet: string, day: string): Promise<RunRow[]> {
  return q<RunRow>(`SELECT ${RUN_COLS} FROM ${T.runs} WHERE wallet = $1 AND day = $2::date ORDER BY attempt`, [wallet, day]);
}

/**
 * Advances a run from exactly `fromMoves` placements. Returns false if the
 * run moved on meanwhile (a replayed or concurrent request), so every run
 * has a single history.
 */
export async function advanceRun(p: {
  id: string; wallet: string; day: string; fromMoves: number; state: RankedState;
  step: { t: number; m: [number, number, number][] }; flag: boolean;
}): Promise<boolean> {
  const rows = await q(
    `UPDATE ${T.runs} SET state = $5::jsonb, log = log || $6::jsonb, score = $7, moves = $8, over = $9,
       flags = flags + $10, last_step_at = now()
     WHERE id = $1 AND wallet = $2 AND day = $3::date AND moves = $4 AND NOT over
     RETURNING id`,
    [p.id, p.wallet, p.day, p.fromMoves, JSON.stringify(p.state), JSON.stringify([p.step]),
      p.state.score, p.state.moves, p.state.over, p.flag ? 1 : 0],
  );
  return rows.length === 1;
}

// ── Leaderboards and publication ────────────────────────────────────

export interface BoardRow { wallet: string; score: number; avatarId: string | null }

/** Best run per wallet on `day`. */
export async function dayBoard(day: string, limit = 100): Promise<BoardRow[]> {
  return q<BoardRow>(
    `SELECT b.wallet, b.score, p.avatar_id AS "avatarId" FROM (
       SELECT wallet, max(score)::float8 AS score FROM ${T.runs}
       WHERE day = $1::date AND score > 0 GROUP BY wallet ORDER BY score DESC, wallet LIMIT $2) b
     LEFT JOIN ${T.players} p ON p.wallet = b.wallet
     ORDER BY b.score DESC, b.wallet`, [day, limit]);
}

/**
 * Month `month` (YYYY-MM): each wallet's score is the sum of its
 * MONTHLY_BEST_DAYS best daily scores (a day's score = its best run), so
 * playing every day buys no edge over playing the best ten.
 */
export async function monthBoard(month: string, limit = 100): Promise<BoardRow[]> {
  return q<BoardRow>(
    `SELECT b.wallet, b.score, p.avatar_id AS "avatarId" FROM (
       SELECT wallet, sum(best)::float8 AS score FROM (
         SELECT wallet, best, row_number() OVER (PARTITION BY wallet ORDER BY best DESC) AS n FROM (
           SELECT wallet, day, max(score) AS best FROM ${T.runs}
           WHERE day >= ($1 || '-01')::date AND day < (($1 || '-01')::date + interval '1 month') AND score > 0
           GROUP BY wallet, day) d
         ) r
       WHERE n <= $3 GROUP BY wallet ORDER BY score DESC, wallet LIMIT $2) b
     LEFT JOIN ${T.players} p ON p.wallet = b.wallet
     ORDER BY b.score DESC, b.wallet`, [month, limit, MONTHLY_BEST_DAYS]);
}

/**
 * USDC (base units) paid into the prize vault per UTC day in [fromDay, toDay),
 * by the purchase's on-chain block time (credit time for rows stored before
 * block_time existed). Days with no purchases are absent.
 */
export async function vaultInflow(fromDay: string, toDay: string): Promise<Map<string, bigint>> {
  const t = 'coalesce(block_time, created_at)';
  const rows = await q<{ day: string; amount: string }>(
    `SELECT to_char((${t} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, sum(vault_amount)::text AS amount
     FROM ${T.purchases}
     WHERE ${t} >= ($1::date)::timestamp AT TIME ZONE 'UTC' AND ${t} < ($2::date)::timestamp AT TIME ZONE 'UTC'
     GROUP BY 1`, [fromDay, toDay]);
  return new Map(rows.map((r) => [r.day, BigInt(r.amount)]));
}

/** Speed-review flags per wallet over [fromDay, toDay), for wallets that have any. */
export async function flagsOf(wallets: string[], fromDay: string, toDay: string): Promise<Map<string, number>> {
  if (wallets.length === 0) return new Map();
  const rows = await q<{ wallet: string; flags: number }>(
    `SELECT wallet, sum(flags)::int AS flags FROM ${T.runs}
     WHERE day >= $1::date AND day < $2::date AND wallet = ANY($3::text[]) AND flags > 0 GROUP BY wallet`,
    [fromDay, toDay, wallets]);
  return new Map(rows.map((r) => [r.wallet, r.flags]));
}

export interface PublishedRun {
  id: string; wallet: string; attempt: number; score: number; moves: number; over: boolean; flags: number;
  log: { t: number; m: [number, number, number][] }[];
}

/** Every run of a finished day, with its full move log, for public verification. */
export async function dayRuns(day: string): Promise<PublishedRun[]> {
  return q<PublishedRun>(
    `SELECT id, wallet, attempt, score::float8 AS score, moves, over, flags, log FROM ${T.runs}
     WHERE day = $1::date ORDER BY wallet, attempt`, [day]);
}

// ── Profiles ────────────────────────────────────────────────────────

export async function getAvatar(wallet: string): Promise<string | null> {
  const rows = await q<{ avatar_id: string | null }>(`SELECT avatar_id FROM ${T.players} WHERE wallet = $1`, [wallet]);
  return rows[0]?.avatar_id ?? null;
}

/** Sets (or, with null, clears) a wallet's avatar slug. */
export async function setAvatar(wallet: string, avatarId: string | null): Promise<void> {
  await q(
    `INSERT INTO ${T.players} (wallet, avatar_id) VALUES ($1, $2)
     ON CONFLICT (wallet) DO UPDATE SET avatar_id = EXCLUDED.avatar_id, updated_at = now()`, [wallet, avatarId]);
}

// ── Prize rounds ────────────────────────────────────────────────────

/** One merkle leaf as stored: wallet, amount (USDC base units, decimal string), rank, score. */
export interface StoredLeaf { w: string; a: string; r: number; s: number }

export interface RoundRow {
  roundId: bigint;
  kind: 'day' | 'month';
  period: string;
  root: string; // hex
  total: bigint;
  leaves: StoredLeaf[]; // leaf index order
  postedSig: string | null;
  postedMs: number | null;
}

const ROUND_COLS = `round_id::text AS round_id, kind, period, root, total::text AS total, leaves, posted_sig,
  (extract(epoch FROM posted_at) * 1000)::float8 AS posted_ms`;

type RawRound = {
  round_id: string; kind: 'day' | 'month'; period: string; root: string; total: string;
  leaves: StoredLeaf[]; posted_sig: string | null; posted_ms: number | null;
};

const toRound = (r: RawRound): RoundRow => ({
  roundId: BigInt(r.round_id), kind: r.kind, period: r.period, root: r.root, total: BigInt(r.total),
  leaves: r.leaves, postedSig: r.posted_sig, postedMs: r.posted_ms,
});

export async function getRound(roundId: bigint): Promise<RoundRow | null> {
  const rows = await q<RawRound>(`SELECT ${ROUND_COLS} FROM ${T.rounds} WHERE round_id = $1`, [roundId.toString()]);
  return rows[0] ? toRound(rows[0]) : null;
}

/**
 * Stores a round unless one with the same id exists, and returns whichever
 * is stored: a round is computed once and never replaced.
 */
export async function saveRound(r: Omit<RoundRow, 'postedSig' | 'postedMs'>): Promise<RoundRow> {
  await q(
    `INSERT INTO ${T.rounds} (round_id, kind, period, root, total, leaves) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (round_id) DO NOTHING`,
    [r.roundId.toString(), r.kind, r.period, r.root, r.total.toString(), JSON.stringify(r.leaves)]);
  return (await getRound(r.roundId))!;
}

/** Records the PostResults transaction and the on-chain posting time (once). */
export async function markRoundPosted(roundId: bigint, sig: string, postedMs: number): Promise<boolean> {
  const rows = await q(
    `UPDATE ${T.rounds} SET posted_sig = $2, posted_at = to_timestamp($3::float8 / 1000)
     WHERE round_id = $1 AND posted_sig IS NULL RETURNING round_id`, [roundId.toString(), sig, postedMs]);
  return rows.length === 1;
}

/** Posted rounds, newest first, that name `wallet` and were posted after `sinceMs`. */
export async function roundsWithWallet(wallet: string, sinceMs: number): Promise<RoundRow[]> {
  const rows = await q<RawRound>(
    `SELECT ${ROUND_COLS} FROM ${T.rounds}
     WHERE posted_sig IS NOT NULL AND posted_at > to_timestamp($2::float8 / 1000) AND leaves @> $1::jsonb
     ORDER BY posted_at DESC`, [JSON.stringify([{ w: wallet }]), sinceMs]);
  return rows.map(toRound);
}
