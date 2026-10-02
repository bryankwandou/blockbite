/**
 * Jupiter SOL → USDC autoconvert (mainnet).
 *
 * The user requirement: BlockBite is USDC-denominated, but most wallets
 * arrive holding SOL. If the buyer doesn't have enough USDC for the ticket
 * they're trying to purchase, we ask Jupiter (https://lite-api.jup.ag) to
 * swap exactly the deficit from SOL into USDC, then the normal ticket
 * purchase (FundVault) runs unchanged.
 *
 * Slippage default: 50 bps (0.5%). Jupiter returns the exact in-amount of
 * SOL it'll consume; we add a 10% buffer to the SOL balance check so a
 * tiny SOL-price wobble between quote and swap doesn't abort.
 */

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { USDC_MINT, USDC_DECIMALS, toUsdcLamports } from './config';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
// quote-api.jup.ag/v6 no longer resolves; lite-api is Jupiter's free Swap API v1.
export const JUP_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
export const JUP_SWAP  = 'https://lite-api.jup.ag/swap/v1/swap';

/** fetch that reports an unreachable Jupiter as "unavailable", not as a crash. */
async function jupFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new SwapUnavailableError();
  }
}
const SLIPPAGE_BPS = 50;

export class SwapUnavailableError extends Error {
  constructor() {
    super('SOL→USDC autoconvert is unavailable right now.');
    this.name = 'SwapUnavailableError';
  }
}

export class SwapFailedError extends Error {
  constructor(reason: string) {
    super(`Jupiter swap failed: ${reason}`);
    this.name = 'SwapFailedError';
  }
}

/**
 * Quote SOL → USDC for exactly `usdcOutAmount` (human USDC, not lamports).
 */
export async function quoteSolForUsdc(usdcOutAmount: number): Promise<{
  inLamports: bigint;  // SOL needed (1e9 = 1 SOL)
  outLamports: bigint; // USDC delivered (1e6 = 1 USDC)
  raw: unknown;
} | null> {
  const outAmount = toUsdcLamports(usdcOutAmount); // u64 string in raw USDC lamports
  const url =
    `${JUP_QUOTE}?inputMint=${SOL_MINT}` +
    `&outputMint=${USDC_MINT.toBase58()}` +
    `&amount=${outAmount}` +
    `&swapMode=ExactOut` +
    `&slippageBps=${SLIPPAGE_BPS}`;

  const res = await jupFetch(url, { cache: 'no-store' });
  if (!res.ok) throw new SwapFailedError(`quote ${res.status}`);
  const json = await res.json();
  if (json.error) throw new SwapFailedError(json.error);

  return {
    inLamports:  BigInt(json.inAmount  ?? json.otherAmountThreshold ?? '0'),
    outLamports: BigInt(json.outAmount ?? '0'),
    raw: json,
  };
}

/**
 * Build a Jupiter swap VersionedTransaction signed by the caller-provided
 * wallet adapter. Returns the tx ready to send.
 */
export async function buildSolToUsdcSwap(
  connection: Connection,
  payer: PublicKey,
  usdcOutAmount: number,
): Promise<VersionedTransaction> {
  const quote = await quoteSolForUsdc(usdcOutAmount);
  if (!quote) throw new SwapUnavailableError();

  const swapRes = await jupFetch(JUP_SWAP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote.raw,
      userPublicKey: payer.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!swapRes.ok) throw new SwapFailedError(`swap ${swapRes.status}`);
  const { swapTransaction } = await swapRes.json();
  if (!swapTransaction) throw new SwapFailedError('no swapTransaction in response');

  const buf = Buffer.from(swapTransaction, 'base64');
  const vtx = VersionedTransaction.deserialize(buf);

  // Recent blockhash is already inside the v0 message Jupiter returned.
  // Wallet adapters that re-fetch blockhash for legacy Transactions will
  // simply re-sign — VersionedTransaction is signed atomically.
  return vtx;
}

/**
 * Convenience: if user needs `usdcDeficit` more USDC than they currently
 * hold, run a SOL→USDC swap for that deficit and wait for confirmation.
 *
 * Returns the swap signature, or null if no swap was needed (deficit ≤ 0).
 */
export async function autoconvertSolForUsdc(params: {
  connection: Connection;
  payer: PublicKey;
  usdcDeficit: number;
  sendTransaction: (
    tx: VersionedTransaction,
    conn: Connection,
  ) => Promise<string>;
}): Promise<string | null> {
  const { connection, payer, usdcDeficit, sendTransaction } = params;
  if (usdcDeficit <= 0) return null;

  const vtx = await buildSolToUsdcSwap(connection, payer, usdcDeficit);
  const sig = await sendTransaction(vtx, connection);
  await connection.confirmTransaction(
    { signature: sig, ...(await connection.getLatestBlockhash()) },
    'confirmed',
  );
  return sig;
}

export { USDC_DECIMALS };
