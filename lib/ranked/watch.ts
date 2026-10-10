/**
 * Prize watcher: compares every round the prize program holds on-chain with
 * the round the server computed (rk_rounds). A round only the POSTER key can
 * create that the database does not know, or whose root/total differ, means
 * the POSTER key was used outside the server: the VETO holder has 24 hours
 * from the posting time to block it.
 *
 * Round account layout (programs/blockbite-prize/src/lib.rs):
 *   0 tag u8 = 2 · 1 vetoed u8 · 4 count u32 · 8 id u64 · 16 root [32]
 *   48 total u64 · 56 claimed u64 · 64 posted i64 (unix s) · 72 prev u64
 */
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { getRound } from './db';
import { PRIZE_PROGRAM_ID, PRIZE_VETO_WINDOW_S, PRIZE_CLAIM_WINDOW_S } from './config';
import { roundAddress, ROUND_HDR } from './prize-ix';

export interface ChainRound {
  address: string;
  roundId: string;
  vetoed: boolean;
  count: number;
  root: string;
  total: string;
  postedAt: number;
}

export interface WatchIssue extends ChainRound {
  problem: 'unknown round' | 'root differs' | 'total differs' | 'not marked posted';
  /** Seconds left to veto; 0 once the window has passed. */
  vetoSecondsLeft: number;
}

export interface WatchReport {
  checkedAt: string;
  rounds: number;
  issues: WatchIssue[];
  /** Issues still inside the veto window: act now. */
  urgent: number;
  /** Rounds the DB says were posted (inside the claim window) that the chain does not hold. */
  missing: MissingRound[];
}

export interface MissingRound { roundId: string; postedSig: string; postedAt: number; problem: 'missing on chain' }

/**
 * rk_rounds rows with posted_sig set that were posted inside the claim window.
 * The DB does not record a close, and the program only closes a round after the
 * claim window (or earlier if fully claimed / vetoed, which no server code does),
 * so a row inside the window with no account is reported.
 */
export async function listPostedRounds(sinceMs: number): Promise<{ roundId: string; postedSig: string; postedMs: number }[]> {
  const { neon } = await import('@neondatabase/serverless');
  const url = process.env.blockbite_DATABASE_URL ?? process.env.RANKED_DATABASE_URL;
  if (!url) throw new Error('Ranked database is not configured');
  const schema = process.env.RANKED_DB_SCHEMA ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('bad RANKED_DB_SCHEMA');
  const rows = await neon(url).query(
    `SELECT round_id::text AS round_id, posted_sig, (extract(epoch FROM posted_at) * 1000)::float8 AS posted_ms
     FROM ${schema}.rk_rounds WHERE posted_sig IS NOT NULL AND posted_at > to_timestamp($1::float8 / 1000)`, [sinceMs]) as any[];
  return rows.map((r) => ({ roundId: r.round_id, postedSig: r.posted_sig, postedMs: Number(r.posted_ms) }));
}

export function parseRound(address: PublicKey, data: Buffer): ChainRound | null {
  if (data.length < ROUND_HDR || data[0] !== 2) return null;
  const id = data.readBigUInt64LE(8);
  // Only the account at createWithSeed(POSTER, id) is that round; anything else is not a round.
  if (!roundAddress(id).equals(address)) return null;
  return {
    address: address.toBase58(),
    roundId: id.toString(),
    vetoed: data[1] !== 0,
    count: data.readUInt32LE(4),
    root: data.subarray(16, 48).toString('hex'),
    total: data.readBigUInt64LE(48).toString(),
    postedAt: Number(data.readBigInt64LE(64)),
  };
}

export async function watchRounds(rpcUrl: string, now = Date.now()): Promise<WatchReport> {
  const conn = new Connection(rpcUrl, 'confirmed');
  const fetchRounds = async () => (await conn.getProgramAccounts(PRIZE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Buffer.from([2])) } }],
  })).map((a) => parseRound(a.pubkey, a.account.data)).filter((r): r is ChainRound => r !== null);
  const posted = await listPostedRounds(now - PRIZE_CLAIM_WINDOW_S * 1000);
  let rounds = await fetchRounds();
  // An empty answer while the DB holds posted rounds may be a truncated RPC reply: ask once more.
  if (!rounds.length && posted.length) rounds = await fetchRounds();
  return checkRounds(rounds, now, posted);
}

/** Matches parsed on-chain rounds against rk_rounds. */
export async function checkRounds(
  rounds: ChainRound[], now = Date.now(),
  posted: { roundId: string; postedSig: string; postedMs: number }[] = [],
): Promise<WatchReport> {
  const issues: WatchIssue[] = [];
  for (const r of rounds) {
    if (r.vetoed) continue;
    const row = await getRound(BigInt(r.roundId));
    const problem: WatchIssue['problem'] | null = !row ? 'unknown round'
      : row.root !== r.root ? 'root differs'
      : row.total.toString() !== r.total ? 'total differs'
      : !row.postedSig ? 'not marked posted'
      : null;
    if (problem) issues.push({ ...r, problem, vetoSecondsLeft: Math.max(0, r.postedAt + PRIZE_VETO_WINDOW_S - Math.floor(now / 1000)) });
  }
  // A round the server posted but has not recorded yet is normal for a moment;
  // every other problem is a post the server did not make.
  const urgent = issues.filter((i) => i.vetoSecondsLeft > 0 && i.problem !== 'not marked posted').length;
  const onChain = new Set(rounds.map((r) => r.roundId));
  const missing: MissingRound[] = posted
    .filter((p) => !onChain.has(p.roundId) && p.postedMs > now - PRIZE_CLAIM_WINDOW_S * 1000)
    .map((p) => ({ roundId: p.roundId, postedSig: p.postedSig, postedAt: Math.floor(p.postedMs / 1000), problem: 'missing on chain' as const }));
  return { checkedAt: new Date(now).toISOString(), rounds: rounds.length, issues, urgent, missing };
}

/** Posts a short alert to ALERT_WEBHOOK_URL (Discord or Slack incoming webhook), if set. */
export async function sendAlert(report: WatchReport): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || !(report.issues.length || report.missing.length)) return false;
  const lines = report.issues.map((i) =>
    `round ${i.roundId}: ${i.problem}, total ${Number(i.total) / 1e6} USDC, ` +
    (i.vetoSecondsLeft > 0 ? `VETO WITHIN ${Math.floor(i.vetoSecondsLeft / 3600)}h ${Math.floor((i.vetoSecondsLeft % 3600) / 60)}m` : 'veto window over'));
  for (const m of report.missing) lines.push(`round ${m.roundId}: ${m.problem} (posted ${new Date(m.postedAt * 1000).toISOString()}, sig ${m.postedSig.slice(0, 12)}...)`);
  const text = `BlockBite prize watcher: ${report.urgent} round(s) need a veto now, ${report.issues.length + report.missing.length} problem(s) in all\n${lines.join('\n')}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }) });
  return res.ok;
}
