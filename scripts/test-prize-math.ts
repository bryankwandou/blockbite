/**
 * Prize money math, no database needed (scripts/test-ranked.ts covers the
 * database paths and needs RANKED_TEST_DATABASE_URL).
 *
 *   npx tsx scripts/test-prize-math.ts
 *
 * Every check here backs a line of lib/ranked/AUDIT.md.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${(e as Error).stack?.split('\n').slice(0, 3).join('\n       ')}`);
  }
}

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const cfg = await import('../lib/ranked/config');
  const results = await import('../lib/ranked/results');
  const merkle = await import('../lib/ranked/merkle');
  const pix = await import('../lib/ranked/prize-ix');
  const { verifyPurchaseTx } = await import('../lib/ranked/purchase-verify');

  const wallets = Array.from({ length: 64 }, () => Keypair.generate().publicKey.toBase58());

  console.log('config');
  await test('splits are whole: 70/25/5, team 30 without referrer, 40/60 day/month, curve = 100%', () => {
    assert.equal(cfg.TICKET_PRICE, Number(cfg.USDC_UNIT));
    assert.equal(cfg.VAULT_SHARE * 10, cfg.TICKET_PRICE * 7);
    assert.equal(cfg.REFERRAL_SHARE * 20, cfg.TICKET_PRICE);
    assert.equal(cfg.TEAM_SHARE - cfg.REFERRAL_SHARE, cfg.TICKET_PRICE / 4);
    assert.equal(cfg.TEAM_SHARE * 10, cfg.TICKET_PRICE * 3);
    assert.equal(cfg.DAILY_POOL_BPS + cfg.MONTHLY_POOL_BPS, cfg.BPS_DENOMINATOR);
    assert.equal(cfg.PAYOUT_CURVE_BPS.reduce((s, x) => s + x, 0), cfg.BPS_DENOMINATOR);
    assert.equal(cfg.MAX_ATTEMPTS_PER_DAY, 3);
    assert.equal(cfg.PURCHASE_COMMITMENT, 'finalized');
  });

  console.log('pool safety');
  await test('sum of payouts never exceeds the pool (20k random boards with ties, pools up to 10^13)', () => {
    const r = rng(42);
    for (let iter = 0; iter < 20_000; iter++) {
      const n = Math.floor(r() * 40);
      const scores = Array.from({ length: n }, () => Math.floor(r() * 6)).sort((a, b) => b - a);
      const board = scores.map((score, i) => ({ wallet: wallets[i], score }));
      const pool = BigInt(Math.floor(r() * 1e13)) % (iter % 7 === 0 ? 100n : 10n ** 13n);
      const p = results.planRound('day', '2026-10-01', pool, board);
      const sum = p.awards.reduce((s, a) => s + a.amount, 0n);
      assert.ok(sum <= pool, `iter ${iter}: ${sum} > ${pool}`);
      assert.equal(sum, p.total);
      assert.equal(p.total + p.unallocated, pool);
      assert.ok(p.unallocated >= 0n);
      for (const a of p.awards) assert.ok(a.amount > 0n);
      assert.equal(new Set(p.awards.map((a) => a.wallet)).size, p.awards.length, 'one leaf per wallet');
    }
  });
  await test('rounding dust is at most one base unit per tie group, and stays unallocated', () => {
    const board = Array.from({ length: 10 }, (_, i) => ({ wallet: wallets[i], score: 10 - i }));
    const p = results.planRound('day', '2026-10-01', 999_999n, board);
    assert.ok(p.unallocated < 10n, `dust ${p.unallocated}`);
  });
  await test('ties are settled without wallet order: shuffling tied wallets changes nobody\'s amount', () => {
    const scores = [9, 7, 7, 7, 5, 4, 4, 3, 2, 1, 1, 1];
    const a = scores.map((score, i) => ({ wallet: wallets[i], score }));
    const b = [...a].reverse().sort((x, y) => y.score - x.score); // same scores, tied wallets reversed
    const amt = (p: ReturnType<typeof results.planRound>) => new Map(p.awards.map((x) => [x.wallet, x.amount]));
    assert.deepEqual(amt(results.planRound('day', '2026-10-01', 1_234_567n, a)), amt(results.planRound('day', '2026-10-01', 1_234_567n, b)));
  });
  await test('day pools + month pool equal the month\'s inflow exactly (no double count, no loss)', () => {
    const r = rng(7);
    for (let k = 0; k < 500; k++) {
      const inflows = Array.from({ length: 31 }, () => BigInt(Math.floor(r() * 1e9)));
      const days = inflows.reduce((s, x) => s + results.dailyPool(x), 0n);
      assert.equal(days + results.monthlyPool(inflows), inflows.reduce((s, x) => s + x, 0n));
    }
  });
  await test('a negative pool is refused', () => {
    assert.throws(() => results.splitPool(-1n, []));
  });

  console.log('periods');
  await test('day and month round ids never collide; every day sits in exactly one month', () => {
    const days = new Set<bigint>();
    const months = new Set<bigint>();
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2031, 0, 1); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      days.add(pix.dayRoundId(d));
      const span = results.periodSpan('month', d.slice(0, 7));
      assert.ok(d >= span.from && d < span.to);
      months.add(pix.monthRoundId(d.slice(0, 7)));
    }
    for (const m of months) assert.ok(!days.has(m));
    assert.equal(days.size, 1826);
    assert.equal(months.size, 60);
  });

  console.log('merkle');
  await test('leaf bytes match the program: index u32 LE | amount u64 LE | round u64 LE | wallet', () => {
    const w = wallets[3];
    const buf = Buffer.alloc(4 + 8 + 8 + 32);
    buf.writeUInt32LE(5, 0);
    buf.writeBigUInt64LE(250_000n, 4);
    buf.writeBigUInt64LE(20261001n, 12);
    new PublicKey(w).toBuffer().copy(buf, 20);
    assert.deepEqual(merkle.leafHash(20261001n, 5, w, 250_000n), createHash('sha256').update(buf).digest());
    const a = randomBytes(32), b = randomBytes(32);
    const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
    assert.deepEqual(merkle.nodeHash(a, b), createHash('sha256').update(Buffer.concat([Buffer.from([1]), lo, hi])).digest());
  });
  await test('largest round (1024 leaves) gives proofs within the program\'s 16-hash limit', () => {
    const leaves = Array.from({ length: cfg.PRIZE_MAX_LEAVES }, (_, i) => ({ wallet: wallets[i % 64], amount: BigInt(i + 1) }));
    const levels = merkle.buildTree(1n, leaves);
    for (const i of [0, 511, 1023]) assert.ok(merkle.proofFor(levels, i).length <= cfg.PRIZE_MAX_PROOF);
    assert.throws(() => pix.claimIx(1n, 0, new PublicKey(wallets[0]), 1n, Array.from({ length: cfg.PRIZE_MAX_PROOF + 1 }, () => new Uint8Array(32))));
  });

  console.log('purchases');
  const W = wallets[0];
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const VAULT = cfg.PRIZE_VAULT.toBase58();
  const TEAM = cfg.TEAM_USDC_ACCOUNT.toBase58();
  const xfer = (dest: string, amount: number, mint = USDC) => ({
    program: 'spl-token',
    parsed: { type: 'transferChecked', info: { authority: W, destination: dest, mint, source: 's', tokenAmount: { amount: String(amount) } } },
  });
  const tx = (ixs: unknown[]) => ({
    meta: { err: null, innerInstructions: [], postTokenBalances: [] },
    transaction: { message: { accountKeys: [{ pubkey: W, signer: true }], instructions: ixs } },
  });
  await test('wrong mint, wrong recipient and partial payments credit nothing', () => {
    assert.deepEqual(verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000)]) as never, W), { tickets: 1, vaultAmount: 700_000n, referralAccount: null });
    const junk = 'So11111111111111111111111111111111111111112';
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 700_000, junk), xfer(TEAM, 300_000, junk)]) as never, W), 'string', 'wrong mint');
    assert.equal(typeof verifyPurchaseTx(tx([xfer(wallets[9], 700_000), xfer(TEAM, 300_000)]) as never, W), 'string', 'wrong recipient');
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 1_050_000), xfer(TEAM, 450_000)]) as never, W), 'string', 'half a ticket');
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 700_000)]) as never, W), 'string', 'team unpaid');
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
