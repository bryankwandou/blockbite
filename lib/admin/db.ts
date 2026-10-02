/**
 * Admin / partner storage (Neon Postgres, server only).
 * Connection pattern from lib/ranked/db.ts. Owns only adm_* and ptn_* tables;
 * ranked rk_* tables are read, never written.
 */

import { neon } from '@neondatabase/serverless';

export const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');

export const T = {
  pageviews: `${SCHEMA}.adm_pageviews`,
  errors: `${SCHEMA}.adm_errors`,
  partners: `${SCHEMA}.ptn_partners`,
  campaigns: `${SCHEMA}.ptn_campaigns`,
  deposits: `${SCHEMA}.ptn_deposits`,
  dcampaigns: `${SCHEMA}.ptn_dist_campaigns`,
  ddeposits: `${SCHEMA}.ptn_dist_deposits`,
  allocations: `${SCHEMA}.ptn_allocations`,
  // read only
  purchases: `${SCHEMA}.rk_purchases`,
  runs: `${SCHEMA}.rk_runs`,
  rounds: `${SCHEMA}.rk_rounds`,
};

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

export function dbUrl(): string | undefined {
  return process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
}

function sql(): Sql {
  const url = dbUrl();
  if (!url) throw new Error('database is not configured');
  client ??= neon(url);
  return client;
}

export async function q<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  await (ready ??= migrate().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

/**
 * Runs statements in one transaction, in order (Neon HTTP transaction). Used
 * with pg_advisory_xact_lock as the first statement to serialize writers.
 */
export async function tx(stmts: { text: string; params?: unknown[] }[]): Promise<Record<string, unknown>[][]> {
  await (ready ??= migrate().catch((e) => { ready = null; throw e; }));
  const s = sql();
  return (await s.transaction(stmts.map((x) => s.query(x.text, x.params ?? [])))) as Record<string, unknown>[][];
}

/** Like q, but returns null when the table does not exist yet (e.g. rk_* before ranked ever ran). */
export async function qMaybe<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[] | null> {
  try {
    return await q<R>(text, params);
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return null; // undefined_table
    throw e;
  }
}

/** The same DDL is run by middleware (lib/admin/telemetry.ts) for adm_pageviews. */
export const PAGEVIEWS_DDL = (schema: string) => `CREATE TABLE IF NOT EXISTS ${schema}.adm_pageviews (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  path text NOT NULL,
  country text,
  referrer text,
  device text NOT NULL,
  visitor text NOT NULL)`;

async function migrate(): Promise<void> {
  const s = sql();
  await s.transaction([
    s.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`),
    s.query(PAGEVIEWS_DDL(SCHEMA)),
    s.query(`CREATE INDEX IF NOT EXISTS adm_pageviews_at ON ${T.pageviews} (at)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.errors} (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      message text NOT NULL,
      stack text,
      path text,
      build text,
      visitor text)`),
    s.query(`CREATE INDEX IF NOT EXISTS adm_errors_at ON ${T.errors} (at)`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.partners} (
      wallet text PRIMARY KEY,
      name text NOT NULL,
      token_mint text NOT NULL,
      contact text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      decided_by text,
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.campaigns} (
      id text PRIMARY KEY,
      partner text NOT NULL,
      token_mint text NOT NULL,
      decimals integer NOT NULL,
      total_amount numeric NOT NULL CHECK (total_amount > 0),
      per_player numeric NOT NULL CHECK (per_player > 0),
      rule text NOT NULL CHECK (rule IN ('daily_top', 'monthly_top', 'level', 'achievement')),
      rule_param text NOT NULL,
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      deposit_address text,
      created_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.deposits} (
      sig text PRIMARY KEY,
      campaign_id text NOT NULL,
      amount numeric NOT NULL,
      verified_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.dcampaigns} (
      id text PRIMARY KEY,
      partner text NOT NULL,
      mint text NOT NULL,
      token_program text NOT NULL,
      decimals integer NOT NULL,
      budget numeric NOT NULL CHECK (budget > 0),
      rule jsonb NOT NULL,
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      paused boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.ddeposits} (
      sig text PRIMARY KEY,
      campaign_id text NOT NULL,
      amount numeric NOT NULL CHECK (amount > 0),
      verified_at timestamptz NOT NULL DEFAULT now())`),
    s.query(`CREATE TABLE IF NOT EXISTS ${T.allocations} (
      id text PRIMARY KEY,
      campaign_id text NOT NULL,
      wallet text NOT NULL,
      period text NOT NULL,
      amount numeric NOT NULL CHECK (amount > 0),
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'paid')),
      dist_sig text,
      tx_sig text,
      last_valid_block_height bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      paid_at timestamptz,
      UNIQUE (campaign_id, wallet, period))`),
    s.query(`CREATE INDEX IF NOT EXISTS ptn_allocations_wallet ON ${T.allocations} (wallet)`),
  ]);
}
