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
import { PRIZE_PROGRAM_ID, PRIZE_VETO_WINDOW_S } from './config';
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
  const accounts = await conn.getProgramAccounts(PRIZE_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(Buffer.from([2])) } }],
  });
  const rounds = accounts.map((a) => parseRound(a.pubkey, a.account.data)).filter((r): r is ChainRound => r !== null);
  return checkRounds(rounds, now);
}

/** Matches parsed on-chain rounds against rk_rounds. */
export async function checkRounds(rounds: ChainRound[], now = Date.now()): Promise<WatchReport> {
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
  return { checkedAt: new Date(now).toISOString(), rounds: rounds.length, issues, urgent };
}

/** Posts a short alert to ALERT_WEBHOOK_URL (Discord or Slack incoming webhook), if set. */
export async function sendAlert(report: WatchReport): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || !report.issues.length) return false;
  const lines = report.issues.map((i) =>
    `round ${i.roundId}: ${i.problem}, total ${Number(i.total) / 1e6} USDC, ` +
    (i.vetoSecondsLeft > 0 ? `VETO WITHIN ${Math.floor(i.vetoSecondsLeft / 3600)}h ${Math.floor((i.vetoSecondsLeft % 3600) / 60)}m` : 'veto window over'));
  const text = `BlockBite prize watcher: ${report.urgent} round(s) need a veto now\n${lines.join('\n')}`;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, text }) });
  return res.ok;
}
