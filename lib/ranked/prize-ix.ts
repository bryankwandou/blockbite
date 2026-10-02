/**
 * Instructions of the blockbite-prize program (browser-safe).
 *
 * Round ids: a day round is YYYYMMDD (2026-10-01 → 20261001), a month round
 * is YYYYMM00 (2026-10 → 20261000). Both are u64, little-endian on-chain.
 *
 * The program never creates accounts (it stays small enough to deploy for
 * under 0.03 SOL). The poster creates them with the system program's
 * CreateAccountWithSeed(base = POSTER, owner = the prize program):
 *   state  seed "state"                 (once, 24 bytes)
 *   round  seed = round id in decimal   ("20261001"), 72 + ceil(count / 8) bytes
 * in the same transaction as PostResults. Only POSTER can sign for those
 * addresses, so nobody else can create them.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import { USDC_MINT } from '@/lib/solana/config';
import { PRIZE_MAX_PROOF, PRIZE_POSTER, PRIZE_PROGRAM_ID, PRIZE_STATE, PRIZE_VAULT, VAULT_AUTHORITY } from './config';

export const STATE_SEED = 'state';
export const STATE_SPACE = 24;
export const ROUND_HDR = 80;

export function dayRoundId(day: string): bigint {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('bad day');
  return BigInt(day.replace(/-/g, ''));
}

export function monthRoundId(month: string): bigint {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('bad month');
  return BigInt(month.replace('-', '') + '00');
}

/** PublicKey.createWithSeed, synchronously: sha256(base ‖ seed ‖ owner). */
export function seedAddress(base: PublicKey, seed: string, owner: PublicKey): PublicKey {
  const s = new TextEncoder().encode(seed);
  if (s.length > 32) throw new Error('seed too long');
  const buf = new Uint8Array(64 + s.length);
  buf.set(base.toBytes(), 0);
  buf.set(s, 32);
  buf.set(owner.toBytes(), 32 + s.length);
  return new PublicKey(sha256(buf));
}

export function roundSeed(roundId: bigint): string {
  return roundId.toString();
}

/** The round account: createWithSeed(POSTER, round id in decimal, program). */
export function roundAddress(roundId: bigint): PublicKey {
  return seedAddress(PRIZE_POSTER, roundSeed(roundId), PRIZE_PROGRAM_ID);
}

/** Bytes of a round account with `count` winners. */
export function roundSpace(count: number): number {
  return ROUND_HDR + Math.ceil(count / 8);
}

/**
 * Makes the program own a fresh account at `seed`'s address. `existing` is
 * the lamports already sitting there (anyone can send SOL to an address,
 * which makes CreateAccountWithSeed fail): then top up, allocate and assign
 * instead.
 */
export function createSeededIxs(seed: string, space: number, rentLamports: number, existing = 0): TransactionInstruction[] {
  const pubkey = seedAddress(PRIZE_POSTER, seed, PRIZE_PROGRAM_ID);
  if (existing === 0) {
    return [SystemProgram.createAccountWithSeed({
      fromPubkey: PRIZE_POSTER, newAccountPubkey: pubkey, basePubkey: PRIZE_POSTER, seed, lamports: rentLamports, space, programId: PRIZE_PROGRAM_ID,
    })];
  }
  const ixs: TransactionInstruction[] = [];
  if (existing < rentLamports) ixs.push(SystemProgram.transfer({ fromPubkey: PRIZE_POSTER, toPubkey: pubkey, lamports: rentLamports - existing }));
  ixs.push(SystemProgram.allocate({ accountPubkey: pubkey, basePubkey: PRIZE_POSTER, seed, space, programId: PRIZE_PROGRAM_ID }));
  return ixs;
}

/** One-time setup: the program's state account (sent before or with the first PostResults). */
export function createStateIxs(rentLamports: number, existing = 0): TransactionInstruction[] {
  return createSeededIxs(STATE_SEED, STATE_SPACE, rentLamports, existing);
}

/** PostResults: promise `total` USDC to the leaves under `root` (poster signs; the round account must already be created, see postRoundIxs). */
export function postResultsIx(roundId: bigint, root: Uint8Array, total: bigint, count: number): TransactionInstruction {
  if (root.length !== 32) throw new Error('root must be 32 bytes');
  const d = Buffer.alloc(53);
  d[0] = 0;
  d.writeBigUInt64LE(roundId, 1);
  Buffer.from(root).copy(d, 9);
  d.writeBigUInt64LE(total, 41);
  d.writeUInt32LE(count, 49);
  return new TransactionInstruction({
    programId: PRIZE_PROGRAM_ID,
    data: d,
    keys: [
      { pubkey: PRIZE_POSTER, isSigner: true, isWritable: true },
      { pubkey: PRIZE_STATE, isSigner: false, isWritable: true },
      { pubkey: roundAddress(roundId), isSigner: false, isWritable: true },
      { pubkey: PRIZE_VAULT, isSigner: false, isWritable: false },
    ],
  });
}

/** Create the round account and post it, in one transaction (signed by POSTER). */
export function postRoundIxs(roundId: bigint, root: Uint8Array, total: bigint, count: number, rentLamports: number, existing = 0): TransactionInstruction[] {
  return [...createSeededIxs(roundSeed(roundId), roundSpace(count), rentLamports, existing), postResultsIx(roundId, root, total, count)];
}

/** Claim: pays leaf `index` to the winner's USDC associated token account. Anyone may send it. */
export function claimIx(roundId: bigint, index: number, wallet: PublicKey, amount: bigint, proof: Uint8Array[]): TransactionInstruction {
  if (proof.length > PRIZE_MAX_PROOF) throw new Error('proof too long');
  const d = Buffer.alloc(13 + 32 * proof.length);
  d[0] = 2;
  d.writeUInt32LE(index, 1);
  d.writeBigUInt64LE(amount, 5);
  proof.forEach((p, i) => Buffer.from(p).copy(d, 13 + 32 * i));
  return new TransactionInstruction({
    programId: PRIZE_PROGRAM_ID,
    data: d,
    keys: [
      { pubkey: PRIZE_STATE, isSigner: false, isWritable: true },
      { pubkey: roundAddress(roundId), isSigner: false, isWritable: true },
      { pubkey: PRIZE_VAULT, isSigner: false, isWritable: true },
      { pubkey: VAULT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(USDC_MINT, wallet), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

/** Claim instructions for a wallet claiming its own prize: open its USDC account if needed, then claim. */
export function claimIxs(payer: PublicKey, roundId: bigint, index: number, amount: bigint, proof: Uint8Array[]): TransactionInstruction[] {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, payer);
  return [createAssociatedTokenAccountIdempotentInstruction(payer, ata, payer, USDC_MINT), claimIx(roundId, index, payer, amount, proof)];
}
