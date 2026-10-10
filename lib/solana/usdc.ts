/**
 * USDC ticket purchases for Ranked.
 *
 * A purchase of n tickets is one transaction of plain USDC transfers from the
 * buyer:
 *   n × 0.70 USDC → prize vault (only the blockbite-prize program can pay out)
 *   n × 0.05 USDC → USDC ATA of the referrer the SERVER has recorded for the
 *                   buyer (ref_signups), created in the same tx if missing.
 *                   No recorded referrer → no referral leg (team gets 30%).
 *   the rest      → team USDC account
 * The server checks exactly this split on-chain before crediting tickets
 * (lib/ranked/purchase-verify.ts verifyPurchaseTx). A transaction it refuses
 * still moves the buyer's USDC and credits nothing, so this file mirrors those
 * rules and checks the built transaction before the wallet signs. A purchase
 * with no referral leg is always accepted: every doubt resolves to "no leg".
 *
 * Error handling:
 *   - InsufficientFundsError  → buyer has less USDC than needed
 *   - NoTokenAccountError     → buyer has no USDC account
 *   - SalesClosedError        → sales not open, or the prize vault does not exist yet
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { USDC_MINT, USDC_DECIMALS, RPC_URL } from './config';
import {
  MAX_TICKETS_PER_PURCHASE, PRIZE_VAULT, RANKED_SALES_OPEN, REFERRAL_SHARE, TEAM_SHARE, TEAM_USDC_ACCOUNT,
  TICKET_PRICE, VAULT_SHARE,
} from '@/lib/ranked/config';

export class InsufficientFundsError extends Error {
  constructor(public have: number, public need: number) {
    super(`Insufficient USDC: have ${have.toFixed(2)}, need ${need.toFixed(2)}`);
    this.name = 'InsufficientFundsError';
  }
}

export class NoTokenAccountError extends Error {
  constructor() {
    super('No USDC token account found in this wallet.');
    this.name = 'NoTokenAccountError';
  }
}

export class SalesClosedError extends Error {
  constructor(detail: string) {
    super(`Ticket sales are closed: ${detail}`);
    this.name = 'SalesClosedError';
  }
}

/** Return the USDC balance of a wallet (0 if no ATA exists). */
export async function getUsdcBalance(connection: Connection, walletPubkey: PublicKey): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(USDC_MINT, walletPubkey);
    const acct = await getAccount(connection, ata);
    return Number(acct.amount) / 10 ** USDC_DECIMALS;
  } catch {
    return 0;
  }
}

/**
 * The referrer the server has recorded for the signed-in buyer, from
 * GET /api/ranked/referrer → { referrer: string | null }. Any failure (route
 * missing, network, bad answer) returns null: a purchase without a referral
 * leg is always accepted, one with a wrong leg is not.
 * Never pass a localStorage / URL referral code here.
 */
export async function fetchRecordedReferrer(authorization: string): Promise<string | null> {
  try {
    const res = await fetch('/api/ranked/referrer', { headers: { Authorization: authorization }, cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as { referrer?: unknown };
    if (typeof j.referrer !== 'string') return null;
    return new PublicKey(j.referrer).toBase58() === j.referrer ? j.referrer : null;
  } catch {
    return null;
  }
}

/**
 * The USDC ATA to pay the referral share to, or null when it must go to the
 * team. Mirrors verifyPurchaseTx: the server only accepts usdcAta(recorded
 * referrer) (no off-curve owner) and never the buyer themself; the vault and
 * team accounts are excluded so the split can't collapse into one recipient.
 */
export function referralCandidate(payer: PublicKey, referrer?: PublicKey | null): PublicKey | null {
  if (!referrer || referrer.equals(payer) || !PublicKey.isOnCurve(referrer.toBytes())) return null;
  const ata = getAssociatedTokenAddressSync(USDC_MINT, referrer);
  if (ata.equals(PRIZE_VAULT) || ata.equals(TEAM_USDC_ACCOUNT) || ata.equals(getAssociatedTokenAddressSync(USDC_MINT, payer))) return null;
  return ata;
}

/**
 * No purchases this close to the end of a UTC day: the server stops crediting
 * a day's purchases RESULTS_GRACE_MS - 2 min after it ends, and a block time
 * that lands just before midnight leaves little time for a slow credit.
 */
export const DAY_END_BLACKOUT_MS = 3 * 60_000;

/** True when a purchase sent at `now` can comfortably be credited (mirror of purchase-verify.ts cutoffs). */
export function purchaseWindowOpen(now = Date.now()): boolean {
  return 86_400_000 - (now % 86_400_000) > DAY_END_BLACKOUT_MS;
}

/**
 * Re-checks a built purchase against the server's rules before the wallet
 * signs: only ATA creation and USDC transferChecked from the buyer's ATA with
 * the buyer as authority; vault = n × 0.70; referral (if any) = n × 0.05 to
 * `referralAccount` only; team = n × 0.30 − referral. Throws on any mismatch.
 */
export function assertPurchaseShape(
  tx: Transaction, payer: PublicKey, tickets: number, referralAccount: PublicKey | null,
): void {
  const fail = (why: string): never => { throw new Error(`purchase check failed before signing: ${why}`); };
  const source = getAssociatedTokenAddressSync(USDC_MINT, payer);
  const n = BigInt(tickets);
  const byDest = new Map<string, bigint>();
  for (const ix of tx.instructions) {
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) continue;
    if (!ix.programId.equals(TOKEN_PROGRAM_ID)) fail('unexpected instruction');
    // transferChecked data: [12, amount u64 LE, decimals]; keys: source, mint, destination, authority
    if (ix.data.length !== 10 || ix.data[0] !== 12 || ix.data[9] !== USDC_DECIMALS) fail('not a USDC transferChecked');
    const [src, mint, dest, owner] = ix.keys.map((k) => k.pubkey);
    if (!src?.equals(source) || !mint?.equals(USDC_MINT) || !dest || !owner?.equals(payer)) fail('wrong source, mint or authority');
    const amount = Buffer.from(ix.data).readBigUInt64LE(1);
    byDest.set(dest.toBase58(), (byDest.get(dest.toBase58()) ?? 0n) + amount);
  }
  const vault = byDest.get(PRIZE_VAULT.toBase58()) ?? 0n;
  const team = byDest.get(TEAM_USDC_ACCOUNT.toBase58()) ?? 0n;
  const others = [...byDest.keys()].filter((d) => d !== PRIZE_VAULT.toBase58() && d !== TEAM_USDC_ACCOUNT.toBase58());
  if (vault !== n * BigInt(VAULT_SHARE)) fail('vault amount');
  const referral = referralAccount ? byDest.get(referralAccount.toBase58()) ?? 0n : 0n;
  if (referralAccount) {
    if (others.length !== 1 || others[0] !== referralAccount.toBase58()) fail('referral recipient');
    if (referral !== n * BigInt(REFERRAL_SHARE)) fail('referral amount');
  } else if (others.length) fail('unexpected recipient');
  if (team !== n * BigInt(TEAM_SHARE) - referral) fail('team amount');
  if (!tx.feePayer?.equals(payer)) fail('fee payer');
}

/**
 * Builds the purchase transaction for `tickets` ranked tickets.
 * `recordedReferrer` must come from fetchRecordedReferrer (the server's record).
 */
export async function buildTicketPurchaseTx(
  connection: Connection,
  payer: PublicKey,
  tickets: number,
  recordedReferrer: string | null,
): Promise<Transaction> {
  if (!RANKED_SALES_OPEN) throw new SalesClosedError('the prize program is not live yet');
  if (!purchaseWindowOpen()) throw new SalesClosedError('the day is about to close; try again a few minutes after 00:00 UTC');
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS_PER_PURCHASE) {
    throw new Error(`Buy between 1 and ${MAX_TICKETS_PER_PURCHASE} tickets at a time`);
  }
  if (!(await connection.getAccountInfo(PRIZE_VAULT, 'confirmed'))) {
    throw new SalesClosedError('the prize vault is not set up yet');
  }

  const n = BigInt(tickets);
  const total = n * BigInt(TICKET_PRICE);
  const source = await getAssociatedTokenAddress(USDC_MINT, payer);
  let balance: bigint;
  try {
    balance = (await getAccount(connection, source)).amount;
  } catch {
    throw new NoTokenAccountError();
  }
  if (balance < total) {
    throw new InsufficientFundsError(Number(balance) / 10 ** USDC_DECIMALS, Number(total) / 10 ** USDC_DECIMALS);
  }

  let referrer: PublicKey | null = null;
  try { referrer = recordedReferrer ? new PublicKey(recordedReferrer) : null; } catch { referrer = null; }
  const referralAccount = referralCandidate(payer, referrer);
  const referral = referralAccount ? n * BigInt(REFERRAL_SHARE) : 0n;

  const send = (to: PublicKey, amount: bigint) =>
    createTransferCheckedInstruction(source, USDC_MINT, to, payer, amount, USDC_DECIMALS);
  const tx = new Transaction();
  // Idempotent ATA creation is pass-through for the server; the buyer pays its
  // rent (~0.002 SOL) only when the referrer has no USDC account yet.
  if (referralAccount && referrer && !(await connection.getAccountInfo(referralAccount, 'confirmed'))) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(payer, referralAccount, referrer, USDC_MINT));
  }
  tx.add(send(PRIZE_VAULT, n * BigInt(VAULT_SHARE)));
  tx.add(send(TEAM_USDC_ACCOUNT, n * BigInt(TEAM_SHARE) - referral));
  if (referralAccount) tx.add(send(referralAccount, referral));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer;
  assertPurchaseShape(tx, payer, tickets, referralAccount);
  return tx;
}

/**
 * Sends a ticket purchase and waits for confirmation.
 * @returns transaction signature — pass it to RankedClient.credit() right away
 */
export async function purchaseTickets(params: {
  connection: Connection;
  payer: PublicKey;
  tickets: number;
  /** From fetchRecordedReferrer; never a localStorage / URL code. */
  recordedReferrer: string | null;
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>;
  /** Called with the signature as soon as it exists, before confirmation (save it for credit recovery). */
  onSent?: (sig: string) => void;
}): Promise<string> {
  const { connection, payer, tickets, recordedReferrer, sendTransaction, onSent } = params;
  const tx = await buildTicketPurchaseTx(connection, payer, tickets, recordedReferrer);
  const sig = await sendTransaction(tx, connection);
  onSent?.(sig);
  const res = await connection.confirmTransaction(
    { signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! },
    'confirmed',
  );
  if (res.value.err) throw new Error(`Purchase failed on-chain: ${JSON.stringify(res.value.err)}`);
  return sig;
}

/** Make a fresh Connection instance (used by server components or standalone calls). */
export function makeConnection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}
