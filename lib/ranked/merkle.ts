/**
 * Prize merkle tree, byte-for-byte the construction checked by
 * programs/blockbite-prize (Claim):
 *
 *   leaf = sha256(index u32 LE ‖ amount u64 LE ‖ round_id u64 LE ‖ wallet 32)   52 bytes
 *   node = sha256(0x01 ‖ min(a, b) ‖ max(a, b))      65 bytes, byte-wise order, no directions
 *
 * (The leaf is the claim's own instruction bytes 1..13 followed by the round
 * id and wallet; the different lengths keep a leaf from passing as a node.)
 *
 * An odd node at the end of a level is carried up unchanged, so a proof is
 * just the list of siblings that exist on the way up.
 */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

export interface Leaf { wallet: string; amount: bigint }

function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function leafHash(roundId: bigint, index: number, wallet: string, amount: bigint): Buffer {
  const i = Buffer.alloc(4);
  i.writeUInt32LE(index);
  return createHash('sha256')
    .update(i)
    .update(u64(amount))
    .update(u64(roundId))
    .update(new PublicKey(wallet).toBuffer())
    .digest();
}

export function nodeHash(a: Buffer, b: Buffer): Buffer {
  const [x, y] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return createHash('sha256').update(Buffer.from([1])).update(x).update(y).digest();
}

/** Levels bottom-up; levels[last][0] is the root. */
export function buildTree(roundId: bigint, leaves: Leaf[]): Buffer[][] {
  if (leaves.length === 0) throw new Error('no leaves');
  const levels = [leaves.map((l, i) => leafHash(roundId, i, l.wallet, l.amount))];
  while (levels[levels.length - 1].length > 1) {
    const l = levels[levels.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < l.length; i += 2) next.push(i + 1 < l.length ? nodeHash(l[i], l[i + 1]) : l[i]);
    levels.push(next);
  }
  return levels;
}

export function rootOf(levels: Buffer[][]): Buffer {
  return levels[levels.length - 1][0];
}

export function proofFor(levels: Buffer[][], index: number): Buffer[] {
  const p: Buffer[] = [];
  let i = index;
  for (const l of levels.slice(0, -1)) {
    const sib = i ^ 1;
    if (sib < l.length) p.push(l[sib]);
    i = Math.floor(i / 2);
  }
  return p;
}

export function verifyProof(root: Buffer, roundId: bigint, index: number, wallet: string, amount: bigint, proof: Buffer[]): boolean {
  let h = leafHash(roundId, index, wallet, amount);
  for (const p of proof) h = nodeHash(h, p);
  return h.equals(root);
}
