/**
 * QA2 lane 08 (security): purchase signature binding, v1/v2 session token
 * confusion, cross-domain (console vs ranked) tokens, revocation logic.
 * No database, no RPC, no keys: throwaway secrets are set below.
 *
 *   npx tsx scripts/test-security-qa2.ts
 */
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import bs58 from 'bs58';

process.env.RANKED_SECRET = randomBytes(32).toString('hex');

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

function newWallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: bs58.encode(raw), sign: (m: string) => bs58.encode(sign(null, Buffer.from(m, 'utf8'), privateKey)) };
}

async function main() {
  const auth = await import('../lib/ranked/auth');
  const rev = await import('../lib/ranked/revocation');
  const pv = await import('../lib/ranked/purchase-verify');
  const cfg = await import('../lib/ranked/config');
  const admin = await import('../lib/admin/session');

  const w = newWallet();
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const token = auth.signIn(w.address, auth.challenge(w.address, NOW), w.sign(auth.challenge(w.address, NOW)), NOW)!;

  await test('v2 token parses; tampering any part fails', () => {
    const s = auth.parseSession(token, NOW)!;
    assert.equal(s.wallet, w.address);
    const [a, b, c, d] = token.split('.');
    assert.equal(auth.parseSession(`${a}.${Number(b) + 1}.${c}.${d}`, NOW), null);
    assert.equal(auth.parseSession(`${a}.${b}.${'A'.repeat(16)}.${d}`, NOW), null);
    assert.equal(auth.parseSession(`${newWallet().address}.${b}.${c}.${d}`, NOW), null);
  });

  await test('v2 -> v1 downgrade (drop sid) is refused', () => {
    const [a, b, , d] = token.split('.');
    assert.equal(auth.parseSession(`${a}.${b}.${d}`, NOW), null);
  });

  await test('v1 token keeps working until expiry; sid is distinct per token', () => {
    const exp = NOW + 3_600_000;
    const k = createHmac('sha256', process.env.RANKED_SECRET!).update('blockbite:ranked:session').digest();
    const m = createHmac('sha256', k).update(`${w.address}.${exp}`).digest('base64url');
    const s = auth.parseSession(`${w.address}.${exp}.${m}`, NOW)!;
    assert.equal(s.sid, `v1:${m}`);
    assert.equal(auth.parseSession(`${w.address}.${exp}.${m}`, exp + 1), null);
  });

  await test('admin console token (same secret) is not a ranked session, and vice versa', () => {
    const msg = admin.challenge('partner', w.address, NOW);
    const at = admin.signIn('partner', w.address, msg, w.sign(msg), NOW)!;
    assert.ok(at);
    assert.equal(auth.parseSession(at, NOW), null);
    // a ranked-signed challenge does not sign in to the console
    const rmsg = auth.challenge(w.address, NOW);
    assert.equal(admin.signIn('partner', w.address, rmsg, w.sign(rmsg), NOW), null);
    const req = new Request('http://x', { headers: { cookie: `bb_ptn=${encodeURIComponent(token)}` } });
    assert.equal(admin.sessionWallet(req, 'partner', NOW), null);
  });

  await test('revocation: single revoke, logout-all by iat, DB error fails closed', async () => {
    const s = auth.parseSession(token, NOW)!;
    const fake = (revoked: boolean, nb: number | null): import('../lib/ranked/revocation').Query => async () => [{ revoked, nb }];
    assert.equal(await rev.isSessionRevoked(s, fake(false, null)), false);
    assert.equal(await rev.isSessionRevoked(s, fake(true, null)), true);
    assert.equal(await rev.isSessionRevoked(s, fake(false, s.iat + 1)), true);
    assert.equal(await rev.isSessionRevoked(s, fake(false, s.iat)), false);
    const req = new Request('http://x', { headers: { authorization: `Bearer ${token}` } });
    await assert.rejects(auth.authedSession(req, async () => { throw new Error('db down'); }, NOW), auth.SessionCheckError);
    assert.equal(await auth.authedSession(req, fake(true, null), NOW), null);
  });

  // ── purchase signature binding ──
  const W = w.address;
  const VAULT = cfg.PRIZE_VAULT.toBase58();
  const TEAM = cfg.TEAM_USDC_ACCOUNT.toBase58();
  const xfer = (dest: string, amount: number) => ({
    program: 'spl-token',
    parsed: { type: 'transferChecked', info: { authority: W, destination: dest, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', source: 's', tokenAmount: { amount: String(amount) } } },
  });
  const SIG0 = bs58.encode(randomBytes(64));
  const SIG1 = bs58.encode(randomBytes(64));
  const purchase = {
    blockTime: Math.floor(NOW / 1000) - 30,
    meta: { err: null, innerInstructions: [] },
    transaction: {
      signatures: [SIG0, SIG1],
      message: { accountKeys: [{ pubkey: W, signer: true }, { pubkey: newWallet().address, signer: true }], instructions: [xfer(VAULT, 700_000), xfer(TEAM, 300_000)] },
    },
  };

  await test('credit is bound to the tx id: a second signer\'s signature is refused', () => {
    assert.equal(typeof pv.verifyPurchaseTx(purchase as never, W, null, NOW, SIG0), 'object');
    assert.match(pv.verifyPurchaseTx(purchase as never, W, null, NOW, SIG1) as string, /not this transaction's id/);
    assert.match(pv.verifyPurchaseTx({ ...purchase, transaction: { ...purchase.transaction, signatures: undefined } } as never, W, null, NOW, SIG0) as string, /not this transaction's id/);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}
main();
