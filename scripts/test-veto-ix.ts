/** npx tsx scripts/test-veto-ix.ts : veto account search against fabricated round buffers (lib.rs offsets). */
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';

function round(id: bigint, prev: bigint, vetoed = 0, tag = 2, count = 8): Uint8Array {
  const b = Buffer.alloc(80 + Math.ceil(count / 8));
  b[0] = tag; b[1] = vetoed; b.writeUInt32LE(count, 4);
  b.writeBigUInt64LE(id, 8); b.writeBigUInt64LE(prev, 72);
  return b;
}
function state(day: bigint, month: bigint): Uint8Array {
  const b = Buffer.alloc(24); b.writeBigUInt64LE(day, 0); b.writeBigUInt64LE(month, 16); return b;
}
let n = 0;
function t(name: string, fn: () => void) { fn(); n++; console.log('  ok ', name); }

async function main() {
  const p = await import('../lib/ranked/prize-ix');
  const k = () => Keypair.generate().publicKey;
  const [a, b, c] = [k(), k(), k()];
  t('offsets match lib.rs', () => { assert.equal(p.R_VETOED, 1); assert.equal(p.R_ID, 8); assert.equal(p.R_PREV, 72); assert.equal(p.ROUND_HDR, 80); });
  t('older day round: picks the live successor', () => {
    const rs = [{ pubkey: a, data: round(20261001n, 0n) }, { pubkey: b, data: round(20261002n, 20261001n) }, { pubkey: c, data: round(20261003n, 20261002n) }];
    assert.equal(p.findVetoNext(20261001n, state(20261003n, 0n), rs)?.toBase58(), b.toBase58());
  });
  t('latest round: none (program restores the mark)', () => {
    const rs = [{ pubkey: b, data: round(20261002n, 20261001n) }];
    assert.equal(p.findVetoNext(20261002n, state(20261002n, 0n), rs), null);
  });
  t('vetoed successor is skipped', () => {
    const rs = [{ pubkey: b, data: round(20261002n, 20261001n, 1) }];
    assert.equal(p.findVetoNext(20261001n, state(20261003n, 0n), rs), null);
  });
  t('no successor: null', () => assert.equal(p.findVetoNext(20261001n, state(20261003n, 0n), [{ pubkey: c, data: round(20261003n, 20261002n) }]), null));
  t('wrong tag or short buffer ignored', () => {
    const rs = [{ pubkey: a, data: round(20261002n, 20261001n, 0, 1) }, { pubkey: b, data: Buffer.alloc(40) }];
    assert.equal(p.findVetoNext(20261001n, state(20261003n, 0n), rs), null);
  });
  t('month ids use the month mark (byte 16)', () => {
    const rs = [{ pubkey: a, data: round(20261100n, 20261000n) }];
    assert.equal(p.findVetoNext(20261000n, state(20261005n, 20261100n), rs)?.toBase58(), a.toBase58());
    assert.equal(p.findVetoNext(20261000n, state(0n, 20261000n), rs), null);
  });
  t('vetoIx: 3 accounts without next, 4th writable with next', () => {
    const cold = k();
    const i3 = p.vetoIx(cold, 20261001n);
    assert.equal(i3.keys.length, 3); assert.deepEqual([...i3.data], [1]);
    const i4 = p.vetoIx(cold, 20261001n, b);
    assert.equal(i4.keys.length, 4); assert.ok(i4.keys[3].isWritable && !i4.keys[3].isSigner);
    assert.equal(i4.keys[3].pubkey.toBase58(), b.toBase58());
  });
  console.log(`${n} passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
