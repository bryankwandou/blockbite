/**
 * Prize results: who won a finished Ranked day or month, and how much
 * (server only).
 *
 * Pools come from what ticket buyers paid into the prize vault, counted on
 * the UTC day the purchase was credited (rk_purchases.created_at):
 *   day D     DAILY_POOL_BPS of D's inflow, rounded down
 *   month M   the rest of every day's inflow in M, so a day's rounding goes
 *             to the month
 *
 * A round pays the top of its board along PAYOUT_CURVE_BPS, rank 1 first.
 * The day board is each wallet's best run; the month board is the sum of
 * each wallet's MONTHLY_BEST_DAYS best days (lib/ranked/db.ts).
 * Wallets tied on score split the curve slots they cover equally, so a tie
 * is never settled by wallet address; a tie across 10th place shares what is
 * left of the curve. Every share is rounded down. Rounding dust, and the
 * slots of a board shorter than the curve, are promised to nobody: they stay
 * in the vault and are reported as `unallocated`.
 *
 * A computed round is stored (rk_rounds) before it is posted and is never
 * recomputed, so the root on-chain and the proofs served to winners always
 * come from the same leaves.
 */
import {
  BPS_DENOMINATOR, DAILY_POOL_BPS, PAYOUT_CURVE_BPS, PRIZE_CLAIM_WINDOW_S, PRIZE_MAX_LEAVES, PRIZE_VETO_WINDOW_S,
  RESULTS_GRACE_MS,
} from './config';
import { dayBoard, getRound, monthBoard, saveRound, vaultInflow, type RoundRow, type StoredLeaf } from './db';
import { buildTree, proofFor, rootOf, type Leaf } from './merkle';
import { dayRoundId, monthRoundId, roundAddress } from './prize-ix';
import { dayOf, isDay } from './seed';

const BPS = BigInt(BPS_DENOMINATOR);
const DAY_MS = 86_400_000;
export { RESULTS_GRACE_MS };

export type RoundKind = 'day' | 'month';

// ── Pools ───────────────────────────────────────────────────────────

/** The day round's pool out of one day's vault inflow. */
export function dailyPool(inflow: bigint): bigint {
  return (inflow * BigInt(DAILY_POOL_BPS)) / BPS;
}

/** The month round's pool: what each day of the month kept back from its day round. */
export function monthlyPool(dayInflows: Iterable<bigint>): bigint {
  let pool = 0n;
  for (const x of dayInflows) pool += x - dailyPool(x);
  return pool;
}

// ── Payouts ─────────────────────────────────────────────────────────

export interface Standing { wallet: string; score: number }
export interface Award { rank: number; wallet: string; score: number; amount: bigint }

/**
 * Splits `pool` over a board sorted by score, highest first. Returns the
 * winners in rank order (this is also merkle leaf order); a winner whose
 * share rounds to zero is left out.
 */
export function splitPool(pool: bigint, board: Standing[]): Award[] {
  if (pool < 0n) throw new Error('negative pool');
  for (let i = 1; i < board.length; i++) {
    if (!(board[i].score <= board[i - 1].score)) throw new Error('board is not sorted by score');
  }
  if (new Set(board.map((b) => b.wallet)).size !== board.length) throw new Error('a wallet appears twice on the board');

  const slots = PAYOUT_CURVE_BPS.length;
  const out: Award[] = [];
  for (let i = 0; i < board.length && i < slots;) {
    let j = i;
    while (j + 1 < board.length && board[j + 1].score === board[i].score) j++;
    let bps = 0;
    for (let k = i; k <= Math.min(j, slots - 1); k++) bps += PAYOUT_CURVE_BPS[k];
    const each = (pool * BigInt(bps)) / (BPS * BigInt(j - i + 1));
    if (each > 0n) {
      for (let k = i; k <= j; k++) out.push({ rank: i + 1, wallet: board[k].wallet, score: board[k].score, amount: each });
    }
    i = j + 1;
  }
  if (out.length > PRIZE_MAX_LEAVES) throw new Error(`a round holds at most ${PRIZE_MAX_LEAVES} winners`);
  return out;
}

export interface RoundPlan {
  kind: RoundKind;
  period: string; // YYYY-MM-DD or YYYY-MM
  roundId: bigint;
  pool: bigint;
  total: bigint; // promised to winners (sum of awards)
  unallocated: bigint; // pool - total, stays in the vault
  awards: Award[];
}

export function roundIdOf(kind: RoundKind, period: string): bigint {
  return kind === 'day' ? dayRoundId(period) : monthRoundId(period);
}

export function planRound(kind: RoundKind, period: string, pool: bigint, board: Standing[]): RoundPlan {
  const awards = splitPool(pool, board);
  const total = awards.reduce((s, a) => s + a.amount, 0n);
  // Vault safety: a round never promises more than its pool (integer floor math
  // guarantees it; this makes any future regression fail loudly, not overpay).
  if (total > pool || awards.some((a) => a.amount <= 0n)) throw new Error(`${period}: payouts exceed the pool`);
  return { kind, period, roundId: roundIdOf(kind, period), pool, total, unallocated: pool - total, awards };
}

// ── Periods ─────────────────────────────────────────────────────────

/** The days a period covers, as [from, to). Throws on a malformed period. */
export function periodSpan(kind: RoundKind, period: string): { from: string; to: string } {
  if (kind === 'day') {
    if (!isDay(period)) throw new Error('bad day (want YYYY-MM-DD)');
    return { from: period, to: dayOf(Date.parse(period + 'T00:00:00Z') + DAY_MS) };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('bad month (want YYYY-MM)');
  const [y, m] = period.split('-').map(Number);
  return { from: `${period}-01`, to: dayOf(Date.UTC(y, m, 1)) };
}

/** True once no run of the period can still change its score. */
export function isFinal(kind: RoundKind, period: string, now = Date.now()): boolean {
  return now >= Date.parse(periodSpan(kind, period).to + 'T00:00:00Z') + RESULTS_GRACE_MS;
}

/** Computes a finished period's round from the database (does not store it). */
export async function computeRound(kind: RoundKind, period: string, now = Date.now()): Promise<RoundPlan> {
  const { from, to } = periodSpan(kind, period);
  if (!isFinal(kind, period, now)) throw new Error(`${period} is not over yet`);
  const inflow = await vaultInflow(from, to);
  const pool = kind === 'day' ? dailyPool(inflow.get(period) ?? 0n) : monthlyPool(inflow.values());
  // One row past the leaf limit, so a tie that would overflow a round is caught.
  const board = kind === 'day'
    ? await dayBoard(period, PRIZE_MAX_LEAVES + 1)
    : await monthBoard(period, PRIZE_MAX_LEAVES + 1);
  return planRound(kind, period, pool, board);
}

// ── Stored rounds and proofs ────────────────────────────────────────

export function leavesOf(plan: RoundPlan): StoredLeaf[] {
  return plan.awards.map((a) => ({ w: a.wallet, a: a.amount.toString(), r: a.rank, s: a.score }));
}

function merkleLeaves(leaves: StoredLeaf[]): Leaf[] {
  return leaves.map((l) => ({ wallet: l.w, amount: BigInt(l.a) }));
}

/** Merkle root (hex) of a round's leaves, as PostResults posts it. */
export function rootOfLeaves(roundId: bigint, leaves: StoredLeaf[]): string {
  return rootOf(buildTree(roundId, merkleLeaves(leaves))).toString('hex');
}

/** Rebuilds a stored round's tree and checks it against the stored root and total. */
export function treeOf(row: Pick<RoundRow, 'roundId' | 'root' | 'total' | 'leaves'>): Buffer[][] {
  const levels = buildTree(row.roundId, merkleLeaves(row.leaves));
  if (rootOf(levels).toString('hex') !== row.root) throw new Error(`round ${row.roundId}: root does not match its leaves`);
  if (row.leaves.reduce((s, l) => s + BigInt(l.a), 0n) !== row.total) throw new Error(`round ${row.roundId}: total does not match its leaves`);
  return levels;
}

/**
 * Stores the plan's round and returns the stored row. If the round id is
 * already stored, that row is returned unchanged and the plan is ignored.
 */
export async function storeRound(plan: RoundPlan): Promise<RoundRow> {
  const existing = await getRound(plan.roundId);
  if (existing) return existing;
  if (plan.total === 0n || plan.awards.length === 0) throw new Error(`${plan.period}: nothing to pay`);
  const leaves = leavesOf(plan);
  const root = rootOfLeaves(plan.roundId, leaves);
  return saveRound({ roundId: plan.roundId, kind: plan.kind, period: plan.period, root, total: plan.total, leaves });
}

/** Everything a winner needs to send Claim (lib/ranked/prize-ix.ts claimIxs). */
export interface Prize {
  roundId: string;
  kind: RoundKind;
  period: string;
  rank: number;
  score: number;
  index: number;
  amount: string; // USDC base units
  proof: string[]; // hex, 32 bytes each
  root: string;
  round: string; // round account address
  postSig: string;
  postedAt: number; // ms
  claimableAt: number; // ms, end of the veto window
  expiresAt: number; // ms, end of the claim window
}

/** `wallet`'s prize in a posted round, or null if it won nothing there. */
export function prizeIn(row: RoundRow, wallet: string): Prize | null {
  const index = row.leaves.findIndex((l) => l.w === wallet);
  if (index < 0 || row.postedSig === null || row.postedMs === null) return null;
  const levels = treeOf(row);
  const leaf = row.leaves[index];
  return {
    roundId: row.roundId.toString(),
    kind: row.kind,
    period: row.period,
    rank: leaf.r,
    score: leaf.s,
    index,
    amount: leaf.a,
    proof: proofFor(levels, index).map((p) => p.toString('hex')),
    root: row.root,
    round: roundAddress(row.roundId).toBase58(),
    postSig: row.postedSig,
    postedAt: row.postedMs,
    claimableAt: row.postedMs + PRIZE_VETO_WINDOW_S * 1000,
    expiresAt: row.postedMs + PRIZE_CLAIM_WINDOW_S * 1000,
  };
}
