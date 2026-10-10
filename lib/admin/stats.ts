/**
 * Dashboard queries (server only). Every block carries `source` so the UI can
 * say where a number came from; empty sources come back as empty arrays or
 * null and the UI shows "no data yet" — nothing is estimated or filled in.
 */

import {
  BPS_DENOMINATOR, DAILY_POOL_BPS, MONTHLY_POOL_BPS, PAYOUT_CURVE_BPS, PRIZE_PROGRAM_ID, PRIZE_STATE, PRIZE_VAULT,
  REFERRAL_SHARE, TICKET_PRICE, VAULT_SHARE,
} from '@/lib/ranked/config';

/** "NOT HANDLED / residual risk" from lib/ranked/AUDIT.md, condensed. Read-only; update when the audit changes. */
const OPEN_RISKS = [
  'Vetoed-round id reuse: a closed or posted round id cannot be re-posted (high-water marks, lib.rs). But after vetoing A and then B, the mark falls back to the vetoed A, so the vetoed id A can never be re-posted corrected. No fund risk; fixing it needs a program upgrade.',
  'POSTER key compromise: a stolen hot key can post any root up to the free vault balance. /api/cron/prize-watch compares every on-chain round with rk_rounds (GitHub Action hourly, Vercel cron daily); any mismatch, also after the veto window, or a posted DB round missing on chain makes the endpoint answer non-200 (409 urgent, 424 otherwise), which fails the Action (GitHub emails the owner) and posts to ALERT_WEBHOOK_URL if set. Rounds closed early (fully claimed or vetoed) are not recorded in the DB and would show as missing.',
  'No refund path for tickets bought but never played; the 70% stays in the pool. Must be stated in player copy.',
  'Rounds with zero winners: that day\'s 40% is never paid and not carried into the month; the USDC stays stuck in the vault with no payout rule.',
  'Unallocated dust and short-board slots accumulate in the vault (same issue as zero-winner rounds).',
  'Speed-review flagged wallets are not excluded automatically; a human decides before --send.',
  'scripts/test-ranked.ts (T-db) has not been run: no RANKED_TEST_DATABASE_URL configured.',
];
import { T, q, qMaybe } from './db';
import { rpc, rpcUrl } from './rpc';
import { adminStats as adminReferralStats } from '@/lib/referrals/db';

const rpcHost = () => { try { return new URL(rpcUrl()).host; } catch { return 'rpc'; } };

export async function traffic() {
  const src = 'adm_pageviews (middleware.ts)';
  const [days, pages, countries, devices, refs, live] = await Promise.all([
    q<{ day: string; views: number; visitors: number }>(
      `SELECT to_char((at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, count(*)::int AS views, count(DISTINCT visitor)::int AS visitors
       FROM ${T.pageviews} WHERE at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`),
    q<{ k: string; n: number }>(`SELECT path AS k, count(*)::int AS n FROM ${T.pageviews} WHERE at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    q<{ k: string; n: number }>(`SELECT coalesce(country, 'unknown') AS k, count(DISTINCT visitor)::int AS n FROM ${T.pageviews} WHERE at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    q<{ k: string; n: number }>(`SELECT device AS k, count(DISTINCT visitor)::int AS n FROM ${T.pageviews} WHERE at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`),
    q<{ k: string; n: number }>(`SELECT referrer AS k, count(*)::int AS n FROM ${T.pageviews} WHERE at > now() - interval '30 days' AND referrer IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    q<{ n: number }>(`SELECT count(DISTINCT visitor)::int AS n FROM ${T.pageviews} WHERE at > now() - interval '15 minutes'`),
  ]);
  return { source: src, days, pages, countries, devices, referrers: refs, live: days.length ? live[0]?.n ?? 0 : null };
}

export async function errors() {
  const rows = await q<{ message: string; n: number; first: string; last: string; paths: string[]; builds: string[]; stack: string | null }>(
    `SELECT message, count(*)::int AS n, min(at)::text AS first, max(at)::text AS last,
       (array_agg(DISTINCT path))[1:5] AS paths, (array_agg(DISTINCT build))[1:3] AS builds, max(stack) AS stack
     FROM ${T.errors} WHERE at > now() - interval '30 days' GROUP BY message ORDER BY max(at) DESC LIMIT 100`);
  return { source: 'adm_errors (lib/analytics/errorReporter.ts → /api/admin/errors)', groups: rows };
}

export async function money() {
  const perDay = await qMaybe<{ day: string; tickets: number; vault: string; ref_tickets: number }>(
    `SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, sum(tickets)::int AS tickets,
       sum(vault_amount)::text AS vault, coalesce(sum(tickets) FILTER (WHERE referral_account IS NOT NULL), 0)::int AS ref_tickets
     FROM ${T.purchases} WHERE created_at > now() - interval '60 days' GROUP BY 1 ORDER BY 1`);
  const days = (perDay ?? []).map((r) => {
    const gross = r.tickets * TICKET_PRICE;
    const referrer = r.ref_tickets * REFERRAL_SHARE;
    const vault = Number(r.vault);
    return { day: r.day, tickets: r.tickets, gross: gross / 1e6, vault: vault / 1e6, referrer: referrer / 1e6, team: (gross - vault - referrer) / 1e6 };
  });
  const top = await qMaybe<{ k: string; tickets: number }>(
    `SELECT referral_account AS k, sum(tickets)::int AS tickets FROM ${T.purchases} WHERE referral_account IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const rounds = await qMaybe<{ posted: number; posted_total: string | null; pending: number }>(
    `SELECT count(*) FILTER (WHERE posted_sig IS NOT NULL)::int AS posted,
       sum(total) FILTER (WHERE posted_sig IS NOT NULL)::text AS posted_total,
       count(*) FILTER (WHERE posted_sig IS NULL)::int AS pending FROM ${T.rounds}`);
  let vaultBalance: number | null = null;
  let vaultReserved: number | null = null;
  let vaultError: string | null = null;
  let vaultNote: string | null = null;
  try {
    // The vault token account is created with the first ticket sale; until then it does not exist
    // and getTokenAccountBalance errors. That is "0 USDC, not opened yet", not an RPC failure.
    const acct = await rpc<{ value: unknown }>('getAccountInfo', [PRIZE_VAULT.toBase58(), { encoding: 'base64' }]);
    if (!acct.value) {
      vaultBalance = 0;
      vaultReserved = 0;
      vaultNote = 'Prize vault not created on mainnet yet: ranked ticket sales are closed, so no USDC has been paid in.';
    } else {
      const r = await rpc<{ value: { amount: string } }>('getTokenAccountBalance', [PRIZE_VAULT.toBase58()]);
      vaultBalance = Number(r.value.amount) / 1e6;
      // PrizeState.reserved: u64 at byte 8 (same layout app/api/prizepool reads).
      const st = await rpc<{ value: { owner: string; data: [string, string] } | null }>(
        'getAccountInfo', [PRIZE_STATE.toBase58(), { encoding: 'base64' }]);
      if (st.value && st.value.owner === PRIZE_PROGRAM_ID.toBase58()) {
        vaultReserved = Number(Buffer.from(st.value.data[0], 'base64').readBigUInt64LE(8)) / 1e6;
      }
    }
  } catch (e) {
    vaultError = 'RPC read failed'; // RPC errors can echo a keyed URL; keep it out of the UI
    console.error('admin money rpc', e);
  }
  const r0 = rounds?.[0];
  return {
    source: {
      sales: 'rk_purchases; split from lib/ranked/config.ts (TICKET_PRICE, VAULT_SHARE, REFERRAL_SHARE)',
      vault: `getTokenAccountBalance(${PRIZE_VAULT.toBase58()}) + PrizeState.reserved(${PRIZE_STATE.toBase58()}) via ${rpcHost()}`,
      payouts: 'rk_rounds',
      referrers: 'rk_purchases.referral_account',
    },
    split: {
      ticket: TICKET_PRICE / 1e6, vault: VAULT_SHARE / 1e6, referrer: REFERRAL_SHARE / 1e6,
      vaultPct: (100 * VAULT_SHARE) / TICKET_PRICE,
      dailyPct: (100 * DAILY_POOL_BPS) / BPS_DENOMINATOR, monthlyPct: (100 * MONTHLY_POOL_BPS) / BPS_DENOMINATOR,
      dailyTop: PAYOUT_CURVE_BPS.length, monthlyTop: PAYOUT_CURVE_BPS.length,
    },
    days,
    topReferrers: (top ?? []).map((r) => ({ k: r.k, tickets: r.tickets, usdc: (r.tickets * REFERRAL_SHARE) / 1e6 })),
    vaultBalance, vaultError, vaultNote, vaultReserved,
    vaultFree: vaultBalance === null ? null : Math.max(0, vaultBalance - (vaultReserved ?? 0)),
    openRisks: OPEN_RISKS,
    payouts: r0 && (r0.posted || r0.pending)
      ? { postedRounds: r0.posted, postedUsdc: r0.posted_total ? Number(r0.posted_total) / 1e6 : 0, unpostedRounds: r0.pending, claimed: null as number | null }
      : null,
    // Claims happen on-chain against the prize program and are not indexed in the DB yet.
    claimedNote: 'claimed/unclaimed: not indexed (on-chain claim receipts are not read yet)',
  };
}

export async function players() {
  const daily = await qMaybe<{ day: string; dau: number; fresh: number }>(
    `WITH f AS (SELECT wallet, min(day) AS first FROM ${T.runs} GROUP BY wallet)
     SELECT to_char(r.day, 'YYYY-MM-DD') AS day, count(DISTINCT r.wallet)::int AS dau,
       count(DISTINCT r.wallet) FILTER (WHERE f.first = r.day)::int AS fresh
     FROM ${T.runs} r JOIN f USING (wallet) WHERE r.day > current_date - 30 GROUP BY r.day ORDER BY r.day`);
  const mau = await qMaybe<{ n: number; runs: number }>(
    `SELECT count(DISTINCT wallet)::int AS n, count(*)::int AS runs FROM ${T.runs} WHERE day > current_date - 30`);
  const ret = await qMaybe<{ cohort: number; d1: number; d7: number }>(
    `WITH f AS (SELECT wallet, min(day) AS first FROM ${T.runs} GROUP BY wallet HAVING min(day) > current_date - 60)
     SELECT count(*)::int AS cohort,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ${T.runs} r WHERE r.wallet = f.wallet AND r.day = f.first + 1))::int AS d1,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ${T.runs} r WHERE r.wallet = f.wallet AND r.day = f.first + 7))::int AS d7
     FROM f WHERE f.first <= current_date - 7`);
  const visitors = await q<{ n: number }>(`SELECT count(DISTINCT visitor)::int AS n FROM ${T.pageviews} WHERE at > now() - interval '1 day'`);
  let referrals: Awaited<ReturnType<typeof adminReferralStats>> | null = null;
  try { referrals = await adminReferralStats(); } catch { /* shown as no data */ }
  return {
    referrals,
    source: { ranked: 'rk_runs (wallets with a ranked run)', visitors: 'adm_pageviews (distinct visitor hash, 24 h)' },
    daily: daily ?? [],
    mau: mau?.[0]?.n ? mau[0].n : null,
    rankedRuns30d: mau?.[0]?.runs ? mau[0].runs : null,
    retention: ret?.[0]?.cohort ? ret[0] : null,
    visitors24h: visitors[0]?.n || null,
    note: 'Adventure-mode players are not stored server-side, so DAU/MAU here count ranked wallets only.',
  };
}

export async function health() {
  const t0 = Date.now();
  let dbMs: number | null = null;
  let dbError: string | null = null;
  try { await q('SELECT 1'); dbMs = Date.now() - t0; } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
  const t1 = Date.now();
  let rpcMs: number | null = null;
  let slot: number | null = null;
  let rpcError: string | null = null;
  try { slot = await rpc<number>('getSlot', []); rpcMs = Date.now() - t1; } catch (e) { rpcError = e instanceof Error ? e.message : String(e); }
  let lastPost: { round: string; kind: string; period: string; at: string; sig: string } | null = null;
  try {
    const r = await qMaybe<{ round: string; kind: string; period: string; at: string; sig: string }>(
      `SELECT round_id::text AS round, kind, period, posted_at::text AS at, posted_sig AS sig FROM ${T.rounds}
       WHERE posted_sig IS NOT NULL ORDER BY posted_at DESC LIMIT 1`);
    lastPost = r?.[0] ?? null;
  } catch { /* shown as no data */ }
  return {
    source: { db: 'SELECT 1 round trip (Neon)', rpc: `getSlot via ${rpcHost()}`, post: 'rk_rounds.posted_at' },
    dbMs, dbError, rpcMs, slot, rpcError, lastPost,
  };
}
