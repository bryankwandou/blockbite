/**
 * Checks a ticket purchase transaction before tickets are credited (server only).
 *
 * A purchase is one mainnet transaction, signed by the buyer, containing only
 * USDC transfers from the buyer:
 *   n × 0.70 USDC → prize vault
 *   n × 0.05 USDC → one referrer token account (optional)
 *   the rest of n × 1 USDC → team USDC account
 * Anything else in the transfers (other destinations, wrong amounts, another
 * authority) rejects the whole purchase.
 */

import { USDC_MINT } from '@/lib/solana/config';
import {
  MAX_TICKETS_PER_PURCHASE, PRIZE_VAULT, PURCHASE_COMMITMENT, REFERRAL_SHARE, TEAM_SHARE, TEAM_USDC_ACCOUNT, VAULT_SHARE,
} from './config';

export interface VerifiedPurchase {
  tickets: number;
  vaultAmount: bigint;
  referralAccount: string | null;
}

interface ParsedIx {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
}

interface ParsedTx {
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
  };
}

const PASS_THROUGH = new Set(['spl-associated-token-account', 'compute-budget', 'spl-memo']);
/**
 * Lighthouse (assertion-only program). Phantom appends its instructions to
 * transactions it signs; rejecting them would take the buyer's USDC and
 * credit nothing. Any token movement it could cause is an inner transfer,
 * which is still refused below.
 */
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';

/** Returns the purchase, or a reason string if the transaction does not qualify. */
export function verifyPurchaseTx(tx: ParsedTx | null, wallet: string): VerifiedPurchase | string {
  if (!tx || !tx.meta || !tx.transaction?.message) return 'transaction not found';
  if (tx.meta.err !== null) return 'transaction failed';
  const keys = tx.transaction.message.accountKeys ?? [];
  if (!keys.some((k) => k.pubkey === wallet && k.signer)) return 'not signed by this wallet';

  const top = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions);
  const byDest = new Map<string, bigint>();

  for (const ix of top) {
    if (ix.program && PASS_THROUGH.has(ix.program)) continue;
    if (!ix.program && ix.programId === LIGHTHOUSE) continue;
    if (ix.program !== 'spl-token') return 'unexpected instruction';
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
    // A plain `transfer` names no mint, and the buyer could name their own
    // account: check what the referral account really is after the tx.
    const idx = keys.findIndex((k) => k.pubkey === referralAccount);
    const bal = (tx.meta.postTokenBalances ?? []).find((b) => b.accountIndex === idx);
    if (idx < 0 || !bal || bal.mint !== USDC_MINT.toBase58()) return 'referral account is not a USDC account';
    if (!bal.owner || bal.owner === wallet) return 'self-referral is not allowed';
  }
  if (team !== n * BigInt(TEAM_SHARE) - referral) return 'bad team amount';

  return { tickets: Number(n), vaultAmount: vault, referralAccount };
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
