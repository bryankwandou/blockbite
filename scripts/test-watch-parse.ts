/** npx tsx scripts/test-watch-parse.ts : watcher parseRound against fabricated round accounts in the lib.rs layout. */
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { parseRound } from '../lib/ranked/watch';
import { roundAddress, dayRoundId, monthRoundId, ROUND_HDR } from '../lib/ranked/prize-ix';

function round(id: bigint, o: { vetoed?: number; count?: number; root?: Buffer; total?: bigint; posted?: bigint; prev?: bigint; tag?: number } = {}): Buffer {
  const count = o.count ?? 9;
  const b = Buffer.alloc(ROUND_HDR + Math.ceil(count / 8));
  b[0] = o.tag ?? 2; b[1] = o.vetoed ?? 0; b.writeUInt32LE(count, 4);
  b.writeBigUInt64LE(id, 8); (o.root ?? Buffer.alloc(32, 7)).copy(b, 16);
  b.writeBigUInt64LE(o.total ?? 5_000_000n, 48); b.writeBigInt64LE(o.posted ?? 1_790_000_000n, 64); b.writeBigUInt64LE(o.prev ?? 0n, 72);
  return b;
}
let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('  ok ', name); };
const day = dayRoundId('2026-10-05'), month = monthRoundId('2026-09');
t('day round decodes every field', () => {
  const r = parseRound(roundAddress(day), round(day, { count: 9, total: 12_345_678n, posted: 1_790_000_123n, root: Buffer.alloc(32, 0xab) }))!;
  assert.deepEqual([r.roundId, r.vetoed, r.count, r.total, r.postedAt, r.root], ['20261005', false, 9, '12345678', 1_790_000_123, 'ab'.repeat(32)]);
});
t('month round + vetoed flag', () => {
  const r = parseRound(roundAddress(month), round(month, { vetoed: 1 }))!;
  assert.equal(r.roundId, '20260900'); assert.equal(r.vetoed, true);
});
t('claimed/prev bytes do not leak into total', () => {
  const b = round(day); b.writeBigUInt64LE(999n, 56); b.writeBigUInt64LE(20261004n, 72);
  assert.equal(parseRound(roundAddress(day), b)!.total, '5000000');
});
t('rejects: wrong tag, short, address not createWithSeed(POSTER,id)', () => {
  assert.equal(parseRound(roundAddress(day), round(day, { tag: 1 })), null);
  assert.equal(parseRound(roundAddress(day), Buffer.alloc(40, 2)), null);
  assert.equal(parseRound(Keypair.generate().publicKey, round(day)), null);
});
console.log(`\n${n} passed, 0 failed`);
