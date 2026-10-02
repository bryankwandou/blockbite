/**
 * Partner token distribution: shared types and the storage interface.
 *
 * Pull model. A partner funds the distributor's associated token account,
 * the server allocates amounts to wallets from rules evaluated on its own
 * data, and each player claims with a transaction they sign and pay for.
 * The two stores (Postgres in store-pg.ts, memory in store-memory.ts) must
 * keep the same guarantees:
 *   - allocated total of a campaign <= min(budget, verified deposits)
 *     (equivalently: open + pending <= deposits - paid), checked atomically;
 *   - (campaign, wallet, period) is unique, so nothing is allocated twice;
 *   - an allocation moves open -> pending only once at a time, and only
 *     pending -> paid | open with the matching signature.
 */

export type RuleKind = 'daily_top' | 'level' | 'achievement';
export const RULE_KINDS: readonly RuleKind[] = ['daily_top', 'level', 'achievement'];

export type Rule =
  | { kind: 'daily_top'; amounts: string[] } // base units per rank; length = N
  | { kind: 'level'; level: number; amount: string }
  | { kind: 'achievement'; id: string; amount: string };

export interface DistCampaign {
  id: string;
  partner: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  budget: bigint;
  rule: Rule;
  startsOn: string; // YYYY-MM-DD (UTC)
  endsOn: string;
  paused: boolean;
  createdAt: string;
}

export type AllocStatus = 'open' | 'pending' | 'paid';

export interface Allocation {
  id: string;
  campaignId: string;
  wallet: string;
  period: string; // YYYY-MM-DD for daily_top, 'once' otherwise
  amount: bigint;
  status: AllocStatus;
  /** Distributor's signature over the live claim message (pending) or the landed one (paid). */
  distSig: string | null;
  /** Transaction id (fee payer's signature) once known. */
  txSig: string | null;
  lastValidBlockHeight: number | null;
  createdAt: string;
  paidAt: string | null;
}

export interface Deposit { sig: string; campaignId: string; amount: bigint; at: string }

export interface Totals { deposited: bigint; allocated: bigint; open: bigint; pending: bigint; paid: bigint; recipients: number }

export interface AllocateResult { inserted: number; duplicate: number; overBudget: number }

export interface DistStore {
  insertCampaign(c: DistCampaign): Promise<void>;
  getCampaign(id: string): Promise<DistCampaign | null>;
  listCampaigns(partner: string | null): Promise<DistCampaign[]>;
  setPaused(id: string, partner: string, paused: boolean): Promise<boolean>;
  /** false when the signature was already recorded (for any campaign). */
  addDeposit(d: Omit<Deposit, 'at'>): Promise<boolean>;
  deposits(campaignId: string): Promise<Deposit[]>;
  /**
   * Inserts rows in order, atomically per call. A row whose
   * (campaign, wallet, period) exists counts as duplicate; a row that would
   * push the allocated total past min(budget, deposited) counts as overBudget
   * and is not inserted, nor is any row after it (rows are in priority order,
   * e.g. by rank, so a lower rank never takes budget a higher rank could not).
   */
  allocate(campaignId: string, rows: { wallet: string; period: string; amount: bigint }[]): Promise<AllocateResult>;
  totals(campaignId: string): Promise<Totals>;
  allocationsOf(campaignId: string): Promise<Allocation[]>;
  allocationsForWallet(wallet: string): Promise<Allocation[]>;
  getAllocation(id: string): Promise<Allocation | null>;
  /** open -> pending iff status is open, wallet matches and the campaign is not paused. */
  toPending(id: string, wallet: string, distSig: string, lastValidBlockHeight: number): Promise<boolean>;
  /** pending -> paid | open iff it is pending with this distSig. */
  settle(id: string, distSig: string, to: 'paid' | 'open', txSig: string | null): Promise<boolean>;
}
