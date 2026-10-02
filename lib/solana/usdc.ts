/**
 * USDC ticket purchases for Ranked.
 *
 * A purchase of n tickets is one transaction of plain USDC transfers from the
 * buyer:
 *   n × 0.70 USDC → prize vault (only the blockbite-prize program can pay out)
 *   n × 0.05 USDC → the referrer, when there is one with a USDC account
 *   the rest      → team USDC account
 * The server checks exactly this split on-chain before crediting tickets
 * (lib/ranked/purchase-verify.ts), so a modified transaction earns nothing.
 *
 * Error handling:
 *   - InsufficientFundsError  → buyer has less USDC than needed
 *   - NoTokenAccountError     → buyer has no USDC account
 *   - SalesClosedError        → sales not open, or the prize vault does not exist yet
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
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
 * The referrer's USDC account to pay, or null when the 5% must go to the team.
 * A referral link is untrusted input: the buyer, the team, the prize-vault
 * authority or an off-curve address (no plain ATA) never count as a referrer.
 * Paying the vault or team "as referrer" would make the server refuse the
 * purchase after the USDC has moved.
 */
export function referralCandidate(payer: PublicKey, referrer?: PublicKey | null): PublicKey | null {
  if (!referrer || referrer.equals(payer) || !PublicKey.isOnCurve(referrer.toBytes())) return null;
  const ata = getAssociatedTokenAddressSync(USDC_MINT, referrer);
  if (ata.equals(PRIZE_VAULT) || ata.equals(TEAM_USDC_ACCOUNT) || ata.equals(getAssociatedTokenAddressSync(USDC_MINT, payer))) return null;
  return ata;
}

/** Builds the purchase transaction for `tickets` ranked tickets. */
export async function buildTicketPurchaseTx(
  connection: Connection,
  payer: PublicKey,
  tickets: number,
  referrer?: PublicKey,
): Promise<Transaction> {
  if (!RANKED_SALES_OPEN) throw new SalesClosedError('the prize program is not live yet');
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

  // Pay the referral share only to an existing USDC account, so the buyer
  // never pays rent to open someone else's account.
  const candidate = referralCandidate(payer, referrer);
  const referralAccount = candidate && (await connection.getAccountInfo(candidate, 'confirmed')) ? candidate : null;
  const referral = referralAccount ? n * BigInt(REFERRAL_SHARE) : 0n;

  const send = (to: PublicKey, amount: bigint) =>
    createTransferCheckedInstruction(source, USDC_MINT, to, payer, amount, USDC_DECIMALS);
  const tx = new Transaction();
  tx.add(send(PRIZE_VAULT, n * BigInt(VAULT_SHARE)));
  tx.add(send(TEAM_USDC_ACCOUNT, n * BigInt(TEAM_SHARE) - referral));
  if (referralAccount) tx.add(send(referralAccount, referral));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer;
  return tx;
}

/**
 * Sends a ticket purchase and waits for confirmation.
 * @returns transaction signature — pass it to RankedClient.credit()
 */
export async function purchaseTickets(params: {
  connection: Connection;
  payer: PublicKey;
  tickets: number;
  referrer?: PublicKey;
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>;
}): Promise<string> {
  const { connection, payer, tickets, referrer, sendTransaction } = params;
  const tx = await buildTicketPurchaseTx(connection, payer, tickets, referrer);
  const sig = await sendTransaction(tx, connection);
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
