/**
 * Small-order ed25519 keys are refused by every verifier (lib/weak-key.ts).
 * Run: npx tsx scripts/test-weak-key.ts
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
// Transitive dep (via @solana/web3.js), used only here to check the hard-coded list.
import { ED25519_TORSION_SUBGROUP } from '@noble/curves/ed25519';
import { isWeakEd25519Key } from '../lib/weak-key';
import { verifySig } from '../lib/sig';
import { signIn, challenge } from '../lib/ranked/auth';

let pass = 0, fail = 0;
const ok = (c: boolean, name: string) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${name}`); c ? pass++ : fail++; };

(async () => {
  for (const hex of ED25519_TORSION_SUBGROUP) ok(isWeakEd25519Key(Buffer.from(hex, 'hex')), `torsion point ${hex.slice(0, 8)}… is weak`);
  for (const b of [0, 1]) {
    // p + b, non-canonical encoding of the order-4 / identity point
    const p = (1n << 255n) - 19n + BigInt(b);
    const le = Buffer.alloc(32); let v = p; for (let i = 0; i < 32; i++) { le[i] = Number(v & 0xffn); v >>= 8n; }
    ok(isWeakEd25519Key(le), `non-canonical p+${b} is weak`);
  }
  let real = 0;
  for (let i = 0; i < 2000; i++) {
    const { publicKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    if (isWeakEd25519Key(raw)) real++;
  }
  ok(real === 0, '2000 random real keys are never weak');

  // The attack: all-zero key + all-zero signature.
  const zero = '1'.repeat(32);
  const now = Date.now();
  ok(signIn(zero, challenge(zero, now), bs58.encode(Buffer.alloc(64)), now) === null, 'ranked signIn refuses all-zero key + zero signature');
  ok(!(await verifySig(zero, 'blockbite:score:x', Buffer.alloc(64).toString('base64'))), 'verifySig refuses all-zero key + zero signature');

  // A real wallet still signs in.
  const kp = generateKeyPairSync('ed25519');
  const addr = bs58.encode(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const msg = challenge(addr, now);
  ok(signIn(addr, msg, bs58.encode(sign(null, Buffer.from(msg), kp.privateKey)), now) !== null, 'real wallet still signs in (ranked)');
  ok(await verifySig(addr, 'hello', sign(null, Buffer.from('hello'), kp.privateKey).toString('base64')), 'real wallet still verifies (verifySig)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
