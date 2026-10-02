/** Read-only Solana JSON-RPC calls (server only). Never signs, never sends. */

import { RPC_URL } from '@/lib/solana/config';

export function rpcUrl(): string {
  return process.env.ADMIN_RPC_URL ?? process.env.RANKED_RPC_URL ?? RPC_URL;
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'rpc error');
  return j.result as T;
}

export interface TokenBalanceRow { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }

export interface ParsedTxLite {
  meta: { err: unknown; preTokenBalances?: TokenBalanceRow[]; postTokenBalances?: TokenBalanceRow[] } | null;
  transaction: { message: { accountKeys: { pubkey: string }[] } };
}

export function getParsedTx(sig: string) {
  return rpc<ParsedTxLite | null>('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
}

/** Decimals of an SPL mint (classic or Token-2022), or null if it is not a mint. */
export async function mintDecimals(mint: string): Promise<number | null> {
  const r = await rpc<{ value: { data?: { parsed?: { type?: string; info?: { decimals?: number } } } } | null }>(
    'getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  const p = r.value?.data?.parsed;
  return p?.type === 'mint' && typeof p.info?.decimals === 'number' ? p.info.decimals : null;
}
