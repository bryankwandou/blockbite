/**
 * Small-order ed25519 public keys. Node's verify (OpenSSL) accepts a signature of
 * 64 zero bytes for the all-zero key, so anyone could sign in as wallet
 * 11111111111111111111111111111111 (or the other small-order keys). Nobody holds a
 * private key for these, so refusing them blocks no real wallet.
 *
 * The 8 torsion points with the sign bit dropped, plus the non-canonical
 * encodings p (=0) and p+1 (=1); same list as libsodium's ge25519_has_small_order.
 * scripts/test-weak-key.ts checks it against @noble/curves' torsion subgroup.
 */
const WEAK = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
];

/** True for a 32-byte key that is small-order (sign bit ignored) or not 32 bytes at all. */
export function isWeakEd25519Key(key: Uint8Array): boolean {
  if (key.length !== 32) return true;
  const k = Buffer.from(key);
  k[31] &= 0x7f;
  return WEAK.includes(k.toString('hex'));
}
