/**
 * Partner token distribution service (server only). Pull model:
 *
 *   partner  --tokens-->  distributor ATA   (verified on-chain, recorded per signature)
 *   server   allocates amounts to wallets from rules (store enforces the budget cap)
 *   player   POST claim -> server moves allocation open->pending, returns a tx
 *            [createATAIdempotent(payer = player), TransferChecked(distributor ATA -> player ATA)]
 *            fee payer = player, partially signed by the distributor
 *   player   signs + sends; confirm (or the next lazy check) marks it paid once
 *            finalized, or open again once its blockhash expired without landing.
 *
 * Invariant: at most one live signed transaction per allocation. A new one is
 * only issued from 'open', and 'pending' only returns to 'open' after the
 * finalized block height has passed the old transaction's lastValidBlockHeight
 * and the old transaction is not found among the player ATA's signatures.
 *
 * The distributor key (PARTNER_DISTRIBUTOR_SECRET) is a separate hot key and
 * must never be the ranked POSTER key. It only signs TransferChecked out of
 * its own ATA, never pays fees or rent.
 */

import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import {
  Connection, Keypair, PublicKey, Transaction, type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { Allocation, DistCampaign, DistStore, Rule, RuleKind, Totals } from './types';
import { RULE_KINDS } from './types';

export interface Eligibility {
  /** Wallets in rank order (best first) for a finished UTC day, at most n. */
  dailyTop(day: string, n: number): Promise<string[]>;
  /** Highest Adventure level reached, or null if unknown. */
  levelOf(wallet: string): Promise<number | null>;
  /** Wallets that unlocked achievement `id` on or before `until` (YYYY-MM-DD). */
  achievementHolders(id: string, until: string): Promise<string[]>;
}

export const MAX_DAILY_TOP = 100;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const ACH_RE = /^[a-z0-9_-]{1,60}$/i;

/** Parses PARTNER_DISTRIBUTOR_SECRET: base58 64-byte secret or a JSON byte array. */
export function parseSecret(v: string | undefined): Keypair | null {
  const s = v?.trim();
  if (!s) return null;
  try {
    const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s) as number[]) : bs58.decode(s);
    return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : null;
  } catch {
    return null;
  }
}

export function isAddress(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 32 || v.length > 44) return false;
  try { return new PublicKey(v).toBase58() === v; } catch { return false; }
}

/** "12.5" with `decimals` -> base units, or null if malformed / too precise. */
export function toBase(s: unknown, decimals: number): bigint | null {
  const v = typeof s === 'number' ? String(s) : typeof s === 'string' ? s.trim() : '';
  const m = /^(\d{1,20})(?:\.(\d+))?$/.exec(v);
  if (!m || (m[2]?.length ?? 0) > decimals) return null;
  return BigInt(m[1] + (m[2] ?? '').padEnd(decimals, '0'));
}

export function fromBase(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

export interface CampaignInput {
  mint?: unknown; budget?: unknown; rule?: unknown; ruleAmounts?: unknown; ruleLevel?: unknown;
  ruleAchievement?: unknown; ruleAmount?: unknown; startsOn?: unknown; endsOn?: unknown;
}

export type ClaimResult =
  | { ok: true; transaction: string; lastValidBlockHeight: number; allocationId: string }
  | { ok: false; status: number; error: string };

export class Distribution {
  constructor(
    private store: DistStore,
    private conn: Connection,
    private distributor: Keypair | null,
    private elig: Eligibility,
    private now: () => Date = () => new Date(),
  ) {}

  get configured() { return Boolean(this.distributor); }
  get distributorAddress(): string | null { return this.distributor?.publicKey.toBase58() ?? null; }

  /** Where a partner sends tokens for this campaign. */
  depositTarget(c: Pick<DistCampaign, 'mint' | 'tokenProgram'>) {
    if (!this.distributor) return null;
    const ata = getAssociatedTokenAddressSync(new PublicKey(c.mint), this.distributor.publicKey, false, new PublicKey(c.tokenProgram));
    return { owner: this.distributor.publicKey.toBase58(), tokenAccount: ata.toBase58() };
  }

  /** Mint owner program (Tokenkeg or Token-2022) and decimals, read on-chain. */
  async mintInfo(mint: string): Promise<{ tokenProgram: string; decimals: number } | null> {
    const info = await this.conn.getParsedAccountInfo(new PublicKey(mint), 'confirmed').catch(() => null);
    const v = info?.value;
    if (!v) return null;
    const owner = v.owner.toBase58();
    if (owner !== TOKEN_PROGRAM_ID.toBase58() && owner !== TOKEN_2022_PROGRAM_ID.toBase58()) return null;
    const d = (v.data as { parsed?: { type?: string; info?: { decimals?: number } } }).parsed;
    return d?.type === 'mint' && typeof d.info?.decimals === 'number' ? { tokenProgram: owner, decimals: d.info.decimals } : null;
  }

  async createCampaign(partner: string, b: CampaignInput): Promise<DistCampaign | string> {
    if (!isAddress(b.mint)) return 'token mint is not a valid address';
    const kind = b.rule as RuleKind;
    if (!RULE_KINDS.includes(kind)) return 'unknown eligibility rule';
    const startsOn = String(b.startsOn ?? '');
    const endsOn = String(b.endsOn ?? '');
    if (!DAY_RE.test(startsOn) || !DAY_RE.test(endsOn) || endsOn < startsOn) return 'start/end dates are invalid';
    const mi = await this.mintInfo(b.mint);
    if (!mi) return 'token mint was not found on-chain (SPL Token or Token-2022)';
    const budget = toBase(b.budget, mi.decimals);
    if (!budget || budget <= 0n) return 'budget is invalid';
    let rule: Rule;
    if (kind === 'daily_top') {
      const list = Array.isArray(b.ruleAmounts) ? b.ruleAmounts
        : String(b.ruleAmounts ?? '').split(/[\s,]+/).filter(Boolean);
      const amounts = list.map((x) => toBase(x, mi.decimals));
      if (!amounts.length || amounts.length > MAX_DAILY_TOP || amounts.some((x) => !x || x <= 0n)) {
        return `per-rank amounts must be 1 to ${MAX_DAILY_TOP} positive numbers`;
      }
      rule = { kind, amounts: amounts.map((x) => (x as bigint).toString()) };
    } else {
      const amount = toBase(b.ruleAmount, mi.decimals);
      if (!amount || amount <= 0n) return 'amount per player is invalid';
      if (kind === 'level') {
        const level = Number(b.ruleLevel);
        if (!Number.isInteger(level) || level < 1 || level > 10_000) return 'level must be a whole number >= 1';
        rule = { kind, level, amount: amount.toString() };
      } else {
        const id = String(b.ruleAchievement ?? '').trim();
        if (!ACH_RE.test(id)) return 'achievement id is required';
        rule = { kind, id, amount: amount.toString() };
      }
    }
    const c: DistCampaign = {
      id: randomBytes(8).toString('hex'), partner, mint: b.mint, tokenProgram: mi.tokenProgram, decimals: mi.decimals,
      budget, rule, startsOn, endsOn, paused: false, createdAt: this.now().toISOString(),
    };
    await this.store.insertCampaign(c);
    return c;
  }

  setPaused(id: string, partner: string, paused: boolean) { return this.store.setPaused(id, partner, paused); }

  /**
   * Read-only check that `sig` is a successful transaction in which the
   * distributor's token account(s) for the campaign mint gained tokens.
   */
  async verifyDeposit(c: DistCampaign, sig: string): Promise<{ amount: bigint } | string> {
    if (!SIG_RE.test(sig)) return 'not a transaction signature';
    if (!this.distributor) return 'distributor is not configured';
    const t = await this.conn.getParsedTransaction(sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!t?.meta) return 'transaction not found or not finalized yet';
    if (t.meta.err !== null) return 'transaction failed on-chain';
    const owner = this.distributor.publicKey.toBase58();
    type Bal = NonNullable<NonNullable<ParsedTransactionWithMeta['meta']>['postTokenBalances']>;
    const sum = (rows: Bal | null | undefined) =>
      (rows ?? []).filter((r) => r.mint === c.mint && r.owner === owner).reduce((a, r) => a + BigInt(r.uiTokenAmount.amount), 0n);
    const delta = sum(t.meta.postTokenBalances) - sum(t.meta.preTokenBalances);
    if (delta <= 0n) return 'this transaction sent no campaign tokens to the distributor';
    const ok = await this.store.addDeposit({ sig, campaignId: c.id, amount: delta });
    return ok ? { amount: delta } : 'this signature was already recorded';
  }

  /** Allocates everything the rule makes due up to now. Safe to call repeatedly. */
  async syncCampaign(c: DistCampaign, wallet?: string) {
    if (c.paused) return { inserted: 0, duplicate: 0, overBudget: 0 };
    const today = utcDay(this.now());
    const rows: { wallet: string; period: string; amount: bigint }[] = [];
    if (c.rule.kind === 'daily_top') {
      const last = c.endsOn < today ? c.endsOn : addDays(today, -1); // only finished days
      const amounts = c.rule.amounts.map((x) => BigInt(x));
      for (let d = c.startsOn; d <= last; d = addDays(d, 1)) {
        const ranked = await this.elig.dailyTop(d, amounts.length);
        ranked.slice(0, amounts.length).forEach((w, i) => rows.push({ wallet: w, period: d, amount: amounts[i] }));
      }
    } else if (today >= c.startsOn) {
      const amount = BigInt(c.rule.amount);
      if (c.rule.kind === 'achievement') {
        const until = c.endsOn < today ? c.endsOn : today;
        for (const w of await this.elig.achievementHolders(c.rule.id, until)) rows.push({ wallet: w, period: 'once', amount });
      } else if (wallet && today <= c.endsOn) {
        const lvl = await this.elig.levelOf(wallet);
        if (lvl !== null && lvl >= c.rule.level) rows.push({ wallet, period: 'once', amount });
      }
    }
    return this.store.allocate(c.id, rows);
  }

  /** Direct allocation through the same budget-capped store call (used by tests and admin tools). */
  allocate(campaignId: string, rows: { wallet: string; period: string; amount: bigint }[]) {
    return this.store.allocate(campaignId, rows);
  }

  async stats(c: DistCampaign) {
    const [t, deposits, allocs] = await Promise.all([this.store.totals(c.id), this.store.deposits(c.id), this.store.allocationsOf(c.id)]);
    const perDay = new Map<string, bigint>();
    for (const a of allocs) if (a.status === 'paid' && a.paidAt) {
      const d = a.paidAt.slice(0, 10);
      perDay.set(d, (perDay.get(d) ?? 0n) + a.amount);
    }
    return { totals: t, deposits, allocations: allocs, paidPerDay: [...perDay].sort().map(([day, v]) => ({ day, amount: v })) };
  }

  listCampaigns(partner: string | null) { return this.store.listCampaigns(partner); }
  getCampaign(id: string) { return this.store.getCampaign(id); }
  totals(id: string): Promise<Totals> { return this.store.totals(id); }

  /** A player's allocations (after running per-wallet rules and lazy settlement). */
  async rewardsFor(wallet: string) {
    const campaigns = await this.store.listCampaigns(null);
    for (const c of campaigns) if (c.rule.kind === 'level') await this.syncCampaign(c, wallet);
    const list = await this.store.allocationsForWallet(wallet);
    const out: (Allocation & { campaign: DistCampaign | null })[] = [];
    for (const a of list) {
      const fresh = a.status === 'pending' ? await this.settle(a) : a;
      out.push({ ...fresh, campaign: campaigns.find((c) => c.id === a.campaignId) ?? null });
    }
    return out;
  }

  /**
   * Resolves a pending allocation from chain state. With `txSig` (from the
   * player) it can confirm immediately once finalized; otherwise it waits for
   * expiry and searches the player ATA's recent signatures.
   */
  async settle(a: Allocation, txSig?: string): Promise<Allocation> {
    if (a.status !== 'pending' || !a.distSig) return a;
    const c = await this.store.getCampaign(a.campaignId);
    if (!c) return a;
    const landed = async (sig: string) => {
      const t = await this.conn.getTransaction(sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!t) return null;
      return t.transaction.signatures.includes(a.distSig as string) ? { ok: t.meta?.err === null } : null;
    };
    if (txSig && SIG_RE.test(txSig)) {
      const r = await landed(txSig);
      if (r?.ok && await this.store.settle(a.id, a.distSig, 'paid', txSig)) return (await this.store.getAllocation(a.id)) ?? a;
    }
    const height = await this.conn.getBlockHeight('finalized').catch(() => null);
    if (height === null || a.lastValidBlockHeight === null || height <= a.lastValidBlockHeight) return a; // may still land
    const ata = getAssociatedTokenAddressSync(new PublicKey(c.mint), new PublicKey(a.wallet), false, new PublicKey(c.tokenProgram));
    const sigs = await this.conn.getSignaturesForAddress(ata, { limit: 50 }, 'finalized').catch(() => null);
    if (!sigs) return a; // RPC trouble: never reopen on missing data
    for (const s of sigs) {
      if (s.err !== null) continue;
      const r = await landed(s.signature);
      if (r?.ok) {
        await this.store.settle(a.id, a.distSig, 'paid', s.signature);
        return (await this.store.getAllocation(a.id)) ?? a;
      }
    }
    await this.store.settle(a.id, a.distSig, 'open', null);
    return (await this.store.getAllocation(a.id)) ?? a;
  }

  async claim(allocationId: string, wallet: string): Promise<ClaimResult> {
    if (!this.distributor) return { ok: false, status: 503, error: 'distribution is not configured on this server' };
    let a = await this.store.getAllocation(allocationId);
    if (!a || a.wallet !== wallet) return { ok: false, status: 404, error: 'no such reward for this wallet' };
    if (a.status === 'pending') a = await this.settle(a);
    if (a.status === 'paid') return { ok: false, status: 409, error: 'already claimed' };
    if (a.status === 'pending') return { ok: false, status: 409, error: 'a claim transaction for this reward is still live; wait for it to land or expire' };
    const c = await this.store.getCampaign(a.campaignId);
    if (!c) return { ok: false, status: 404, error: 'campaign not found' };
    if (c.paused) return { ok: false, status: 423, error: 'this campaign is paused' };

    const mint = new PublicKey(c.mint);
    const prog = new PublicKey(c.tokenProgram);
    const player = new PublicKey(wallet);
    const playerAta = getAssociatedTokenAddressSync(mint, player, false, prog);
    const distAta = getAssociatedTokenAddressSync(mint, this.distributor.publicKey, false, prog);
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('finalized');
    const t = new Transaction({ feePayer: player, blockhash, lastValidBlockHeight }).add(
      createAssociatedTokenAccountIdempotentInstruction(player, playerAta, player, mint, prog),
      createTransferCheckedInstruction(distAta, mint, playerAta, this.distributor.publicKey, a.amount, c.decimals, [], prog),
    );
    // Ed25519 signing is deterministic; the signed bytes leave this function
    // only after the allocation has atomically become 'pending' with this signature.
    t.partialSign(this.distributor);
    const ds = t.signatures.find((x) => x.publicKey.equals(this.distributor!.publicKey))?.signature;
    if (!ds) return { ok: false, status: 500, error: 'signing failed' };
    const distSig = bs58.encode(ds);
    if (!(await this.store.toPending(a.id, wallet, distSig, lastValidBlockHeight))) {
      return { ok: false, status: 409, error: 'this reward is not claimable right now (claimed, live, or paused)' };
    }
    const transaction = t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    return { ok: true, transaction, lastValidBlockHeight, allocationId: a.id };
  }

  async confirm(allocationId: string, wallet: string, txSig?: string) {
    const a = await this.store.getAllocation(allocationId);
    if (!a || a.wallet !== wallet) return null;
    return this.settle(a, txSig);
  }
}
