/**
 * Referral signups (Neon Postgres, server only). Connection pattern from
 * lib/ranked/db.ts.
 *
 * A referral link is https://<site>/r/<referrer wallet>. Before this table the
 * code was kept in the browser (localStorage bb_referrer_code) and only reached
 * the server inside a ticket purchase (rk_purchases.referral_account), so a
 * signup that never bought a ticket was not recorded anywhere.
 *
 * One row per referred wallet. Inflation guards:
 *   - PRIMARY KEY (referred): a wallet can be referred once, first claim wins.
 *   - CHECK (referred <> referrer): no self-referral.
 *   - claimReferral refuses a wallet that already has any activity (runs,
 *     tickets, profile, adventure progress), so existing players cannot be
 *     claimed afterwards, and refuses a mutual pair (A->B while B->A exists).
 */

import { neon } from '@neondatabase/serverless';
import { isWallet } from '@/lib/ranked/auth';

const SCHEMA = process.env.RANKED_DB_SCHEMA ?? 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('bad RANKED_DB_SCHEMA');
const REF = `${SCHEMA}.ref_signups`;

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

export function referralsConfigured(): boolean {
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
    await s.query(`CREATE TABLE IF NOT EXISTS ${REF} (
      referred text PRIMARY KEY,
      referrer text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ref_signups_not_self CHECK (referred <> referrer))`);
    await s.query(`CREATE INDEX IF NOT EXISTS ref_signups_referrer ON ${REF} (referrer, created_at DESC)`);
    await s.query(`CREATE INDEX IF NOT EXISTS ref_signups_created ON ${REF} (created_at)`);
  })().catch((e) => { ready = null; throw e; }));
  return (await sql().query(text, params)) as R[];
}

/** 4 first + 4 last characters; the full address never leaves the server in public lists. */
export function shortWallet(w: string): string {
  return w.length < 12 ? w : `${w.slice(0, 4)}…${w.slice(-4)}`;
}

/** Tables other features own; a missing one just means that signal is absent. */
async function existing(): Promise<{ runs: boolean; adv: boolean; credits: boolean; buys: boolean; players: boolean }> {
  const r = await q<Record<string, boolean>>(
    `SELECT to_regclass('${SCHEMA}.rk_runs') IS NOT NULL AS runs, to_regclass('${SCHEMA}.adv_progress') IS NOT NULL AS adv,
            to_regclass('${SCHEMA}.rk_credits') IS NOT NULL AS credits, to_regclass('${SCHEMA}.rk_purchases') IS NOT NULL AS buys,
            to_regclass('${SCHEMA}.rk_players') IS NOT NULL AS players`);
  const x = r[0] ?? {};
  return { runs: !!x.runs, adv: !!x.adv, credits: !!x.credits, buys: !!x.buys, players: !!x.players };
}

/** SQL boolean: "this referred wallet (column alias w) has played". */
function playedSql(e: Awaited<ReturnType<typeof existing>>, col: string): string {
  const parts: string[] = [];
  if (e.runs) parts.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.rk_runs x WHERE x.wallet = ${col})`);
  if (e.adv) parts.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.adv_progress x WHERE x.wallet = ${col} AND x.games > 0)`);
  return parts.length ? `(${parts.join(' OR ')})` : 'false';
}

export type ClaimResult = 'recorded' | 'duplicate' | 'self' | 'existing_player' | 'invalid';

/** Records referrer -> referred once. Never throws for a rule violation. */
export async function claimReferral(referrer: unknown, referred: unknown): Promise<ClaimResult> {
  if (!isWallet(referrer) || !isWallet(referred)) return 'invalid';
  if (referrer === referred) return 'self';
  const e = await existing();
  const activity: string[] = [];
  if (e.runs) activity.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.rk_runs WHERE wallet = $1)`);
  if (e.adv) activity.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.adv_progress WHERE wallet = $1)`);
  if (e.credits) activity.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.rk_credits WHERE wallet = $1)`);
  if (e.buys) activity.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.rk_purchases WHERE wallet = $1)`);
  if (e.players) activity.push(`EXISTS (SELECT 1 FROM ${SCHEMA}.rk_players WHERE wallet = $1)`);
  // $2 = referrer. Single statement: the checks and the insert cannot interleave with themselves.
  const rows = await q(
    `INSERT INTO ${REF} (referred, referrer)
     SELECT $1::text, $2::text
     WHERE NOT (${activity.length ? activity.join(' OR ') : 'false'})
       AND NOT EXISTS (SELECT 1 FROM ${REF} WHERE referred = $2 AND referrer = $1)
     ON CONFLICT (referred) DO NOTHING RETURNING referred`,
    [referred, referrer]);
  if (rows.length) return 'recorded';
  const dup = await q(`SELECT 1 FROM ${REF} WHERE referred = $1`, [referred]);
  return dup.length ? 'duplicate' : 'existing_player';
}

export interface MyReferrals {
  wallet: string;
  total: number;
  played: number;
  recent: { wallet: string; at: string; played: boolean }[];
}

export async function referralsOf(wallet: string): Promise<MyReferrals> {
  const e = await existing();
  const played = playedSql(e, 'r.referred');
  const [sum, recent] = await Promise.all([
    q<{ total: number; played: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE ${played})::int AS played FROM ${REF} r WHERE r.referrer = $1`, [wallet]),
    q<{ referred: string; at: string; played: boolean }>(
      `SELECT r.referred, r.created_at::text AS at, ${played} AS played FROM ${REF} r
       WHERE r.referrer = $1 ORDER BY r.created_at DESC LIMIT 10`, [wallet]),
  ]);
  return {
    wallet,
    total: sum[0]?.total ?? 0,
    played: sum[0]?.played ?? 0,
    recent: recent.map((x) => ({ wallet: shortWallet(x.referred), at: x.at, played: x.played })),
  };
}

export interface PublicReferralStats {
  total: number;
  referrers: number;
  top: { wallet: string; count: number }[];
}

export async function publicStats(): Promise<PublicReferralStats> {
  const [sum, top] = await Promise.all([
    q<{ total: number; referrers: number }>(`SELECT count(*)::int AS total, count(DISTINCT referrer)::int AS referrers FROM ${REF}`),
    q<{ referrer: string; n: number }>(
      `SELECT referrer, count(*)::int AS n FROM ${REF} GROUP BY referrer ORDER BY n DESC, min(created_at) LIMIT 10`),
  ]);
  return {
    total: sum[0]?.total ?? 0,
    referrers: sum[0]?.referrers ?? 0,
    top: top.map((x) => ({ wallet: shortWallet(x.referrer), count: x.n })),
  };
}

/** Admin view: totals, last 30 UTC days (zero-filled) and top referrers with full wallets. */
export async function adminStats() {
  const e = await existing();
  const played = playedSql(e, 'r.referred');
  const [sum, days, top] = await Promise.all([
    q<{ total: number; referrers: number; played: number }>(
      `SELECT count(*)::int AS total, count(DISTINCT referrer)::int AS referrers,
              count(*) FILTER (WHERE ${played})::int AS played FROM ${REF} r`),
    q<{ day: string; n: number }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
              (SELECT count(*)::int FROM ${REF} r WHERE (r.created_at AT TIME ZONE 'UTC')::date = d::date) AS n
       FROM generate_series((now() AT TIME ZONE 'UTC')::date - 29, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
       ORDER BY d`),
    q<{ k: string; n: number; played: number }>(
      `SELECT r.referrer AS k, count(*)::int AS n, count(*) FILTER (WHERE ${played})::int AS played
       FROM ${REF} r GROUP BY r.referrer ORDER BY n DESC, min(r.created_at) LIMIT 15`),
  ]);
  return {
    source: 'ref_signups (recorded when a wallet first connects through /r/<referrer>)',
    total: sum[0]?.total ?? 0,
    referrers: sum[0]?.referrers ?? 0,
    played: sum[0]?.played ?? 0,
    days,
    top,
  };
}
