/**
 * Checks a ticket purchase transaction before tickets are credited (server only).
 *
 * A purchase is one mainnet transaction, signed by the buyer, containing only
 * USDC transfers from the buyer:
 *   n × 0.70 USDC → prize vault
 *   n × 0.05 USDC → the USDC ATA of the buyer's recorded referrer (only if
 *                   one is recorded; otherwise this share goes to the team)
 *   the rest of n × 1 USDC → team USDC account
 * The tx must be at most PURCHASE_MAX_AGE_MS old and credited before its UTC
 * day's results are cut; its pool day is its blockTime's UTC day.
 * Anything else in the transfers (other destinations, wrong amounts, another
 * authority) rejects the whole purchase.
 */

import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { USDC_MINT } from '@/lib/solana/config';
import {
  MAX_TICKETS_PER_PURCHASE, PRIZE_VAULT, PURCHASE_COMMITMENT, REFERRAL_SHARE, RESULTS_GRACE_MS, TEAM_SHARE,
  TEAM_USDC_ACCOUNT, VAULT_SHARE,
} from './config';
import { dayOf } from './seed';

/** Oldest purchase tx credited; a buyer's client polls for seconds, not days. */
export const PURCHASE_MAX_AGE_MS = 6 * 3_600_000;
/** Credits stop this long before the pool day's results are computed (RESULTS_GRACE_MS after it ends). */
const POOL_CUTOFF_MARGIN_MS = 2 * 60_000;

export interface VerifiedPurchase {
  tickets: number;
  vaultAmount: bigint;
  referralAccount: string | null;
  /** On-chain time of the tx (ms); its UTC day is the pool day. */
  blockTimeMs: number;
}

interface ParsedIx {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
}

interface ParsedTx {
  blockTime?: number | null;
  meta?: {
    err: unknown;
    innerInstructions?: { instructions: ParsedIx[] }[];
    postTokenBalances?: { accountIndex: number; mint: string; owner?: string }[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: { pubkey: string; signer: boolean }[];
      instructions?: ParsedIx[];
    };
    signatures?: string[];
  };
}

const PASS_THROUGH = new Set(['spl-associated-token-account', 'spl-memo']);
/**
 * Compute Budget (priority fee / CU limit). Phantom, Solflare and Backpack add
 * these to transactions they sign. jsonParsed does NOT parse this program (no
 * `program` field, only `programId`), so it must be matched by id: matching
 * the name 'compute-budget' never fired and every wallet-priced buy was refused.
 */
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
/** Classic SPL Token; USDC lives here. jsonParsed labels Token-2022 'spl-token' too. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/**
 * Lighthouse (assertion-only program). Phantom appends its instructions to
 * transactions it signs; rejecting them would take the buyer's USDC and
 * credit nothing. Any token movement it could cause is an inner transfer,
 * which is still refused below.
 */
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';

/** USDC ATA of a wallet, or null if it is not a valid address. */
export function usdcAta(owner: string): string | null {
  try {
    return getAssociatedTokenAddressSync(USDC_MINT, new PublicKey(owner)).toBase58();
  } catch {
    return null;
  }
}

/**
 * Returns the purchase, or a reason string if the transaction does not qualify.
 * `referrer` = the referrer recorded for `wallet` (lib/referrals), or null.
 */
export function verifyPurchaseTx(
  tx: ParsedTx | null, wallet: string, referrer: string | null, now = Date.now(), sig?: string,
): VerifiedPurchase | string {
  if (!tx || !tx.meta || !tx.transaction?.message) return 'transaction not found';
  // The credit is keyed by `sig`: it must be the transaction's id (first signature),
  // or a multi-signer purchase could be credited once per signature by an RPC that
  // indexes every signature.
  if (sig !== undefined && tx.transaction.signatures?.[0] !== sig) return "signature is not this transaction's id";
  if (tx.meta.err !== null) return 'transaction failed';
  if (typeof tx.blockTime !== 'number') return 'transaction has no block time';
  const blockTimeMs = tx.blockTime * 1000;
  if (now - blockTimeMs > PURCHASE_MAX_AGE_MS) return 'purchase is too old';
  const poolDayEnd = Date.parse(dayOf(blockTimeMs) + 'T00:00:00Z') + 86_400_000;
  if (now >= poolDayEnd + RESULTS_GRACE_MS - POOL_CUTOFF_MARGIN_MS) return "purchase day's results are already final";
  const keys = tx.transaction.message.accountKeys ?? [];
  if (!keys.some((k) => k.pubkey === wallet && k.signer)) return 'not signed by this wallet';

  const top = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions);
  const byDest = new Map<string, bigint>();

  for (const ix of top) {
    if (ix.program && PASS_THROUGH.has(ix.program)) continue;
    if (!ix.program && (ix.programId === LIGHTHOUSE || ix.programId === COMPUTE_BUDGET)) continue;
    if (ix.program !== 'spl-token') return 'unexpected instruction';
    if (ix.programId !== undefined && ix.programId !== TOKEN_PROGRAM) return 'not the SPL Token program';
    const type = ix.parsed?.type;
    const info = ix.parsed?.info ?? {};
    if (type !== 'transfer' && type !== 'transferChecked') return 'unexpected token instruction';
    if (info.authority !== wallet) return 'transfer not authorised by this wallet';
    if (type === 'transferChecked' && info.mint !== USDC_MINT.toBase58()) return 'not USDC';
    const raw = type === 'transfer'
      ? info.amount
      : (info.tokenAmount as { amount?: unknown } | undefined)?.amount;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 'bad amount';
    const dest = String(info.destination);
    byDest.set(dest, (byDest.get(dest) ?? 0n) + BigInt(raw));
  }
  // Associated-token-account creation may transfer through inner instructions;
  // token movements anywhere else are not part of a purchase.
  for (const ix of inner) {
    const t = ix.parsed?.type;
    if (ix.program === 'spl-token' && (t === 'transfer' || t === 'transferChecked')) return 'unexpected inner transfer';
  }

  const vault = byDest.get(PRIZE_VAULT.toBase58()) ?? 0n;
  const team = byDest.get(TEAM_USDC_ACCOUNT.toBase58()) ?? 0n;
  const others = [...byDest.keys()].filter((d) => d !== PRIZE_VAULT.toBase58() && d !== TEAM_USDC_ACCOUNT.toBase58());
  if (others.length > 1) return 'too many recipients';

  const v = BigInt(VAULT_SHARE);
  if (vault === 0n || vault % v !== 0n) return 'vault amount is not a whole number of tickets';
  const n = vault / v;
  if (n > BigInt(MAX_TICKETS_PER_PURCHASE)) return 'too many tickets in one purchase';

  const referralAccount = others[0] ?? null;
  const referral = referralAccount ? byDest.get(referralAccount)! : 0n;
  if (referralAccount && referral !== n * BigInt(REFERRAL_SHARE)) return 'bad referral amount';
  if (referralAccount) {
    // Only the recorded referrer's USDC ATA (fixes mint and owner); with no
    // referrer on record the 5% belongs to the team, so a third recipient is refused.
    if (!referrer || referrer === wallet) return 'no referrer is recorded for this wallet';
    if (referralAccount !== usdcAta(referrer)) return "referral account is not the referrer's USDC account";
  }
  if (team !== n * BigInt(TEAM_SHARE) - referral) return 'bad team amount';

  return { tickets: Number(n), vaultAmount: vault, referralAccount, blockTimeMs };
}

/** Fetches a finalized transaction in parsed form from mainnet. */
export async function fetchParsedTx(rpcUrl: string, sig: string): Promise<ParsedTx | null> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [sig, { encoding: 'jsonParsed', commitment: PURCHASE_COMMITMENT, maxSupportedTransactionVersion: 0 }],
    }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = await res.json();
  return (json?.result as ParsedTx | null) ?? null;
}
