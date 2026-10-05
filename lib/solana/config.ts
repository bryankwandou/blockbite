/**
 * Solana network configuration — single source of truth.
 * All other files import from here; never hard-code RPC or mints elsewhere.
 */

import { PublicKey } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

// ── Network ────────────────────────────────────────────────────────
// Solana mainnet only.
export const ACTIVE_NETWORK: WalletAdapterNetwork = WalletAdapterNetwork.Mainnet;

// ── RPC endpoint ───────────────────────────────────────────────────
// Set NEXT_PUBLIC_RPC_URL to a private mainnet node in production. A devnet or
// testnet URL is ignored so a stale env var can never point the app off mainnet.
// On the server, SERVER_RPC_URL (never sent to browsers) wins, so the public key
// can be locked to the site's domain without breaking server-side checks, which
// send no Origin header.
const mainnetOnly = (u: string | undefined) => (u && !/devnet|testnet/i.test(u) ? u : undefined);
const SERVER_RPC = typeof window === 'undefined' ? mainnetOnly(process.env.SERVER_RPC_URL) : undefined;
export const RPC_URL = SERVER_RPC ?? mainnetOnly(process.env.NEXT_PUBLIC_RPC_URL) ?? 'https://api.mainnet-beta.solana.com';

// ── USDC ───────────────────────────────────────────────────────────
// Circle's USDC on Solana mainnet.
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const USDC_DECIMALS = 6;

// ── Platform wallets ───────────────────────────────────────────────
// Receives the team share of ticket revenue (lib/ranked/config.ts).
export const TEAM_WALLET = new PublicKey('ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m');

// ── Token amounts ──────────────────────────────────────────────────
/** Convert a human USDC amount to raw u64 lamports (6 decimals). */
export function toUsdcLamports(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

/** Convert raw u64 lamports back to human USDC. */
export function fromUsdcLamports(lamports: bigint): number {
  return Number(lamports) / 10 ** USDC_DECIMALS;
}

// ── Solana Explorer link ───────────────────────────────────────────
export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}`;
}

export function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}`;
}
