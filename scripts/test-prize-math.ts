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
  // Mid-day, so the age and results-cut rules never trigger by accident.
  const NOW = Date.parse('2026-10-06T12:00:00Z');
  const BT = Math.floor(NOW / 1000) - 30;
  const tx = (ixs: unknown[]) => ({
    blockTime: BT,
    meta: { err: null, innerInstructions: [], postTokenBalances: [] },
    transaction: { message: { accountKeys: [{ pubkey: W, signer: true }], instructions: ixs } },
  });
  await test('wrong mint, wrong recipient and partial payments credit nothing', () => {
    assert.deepEqual(verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000)]) as never, W, null, NOW),
      { tickets: 1, vaultAmount: 700_000n, referralAccount: null, blockTimeMs: BT * 1000 });
    const junk = 'So11111111111111111111111111111111111111112';
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 700_000, junk), xfer(TEAM, 300_000, junk)]) as never, W, null, NOW), 'string', 'wrong mint');
    assert.equal(typeof verifyPurchaseTx(tx([xfer(wallets[9], 700_000), xfer(TEAM, 300_000)]) as never, W, null, NOW), 'string', 'wrong recipient');
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 1_050_000), xfer(TEAM, 450_000)]) as never, W, null, NOW), 'string', 'half a ticket');
    assert.equal(typeof verifyPurchaseTx(tx([xfer(VAULT, 700_000)]) as never, W, null, NOW), 'string', 'team unpaid');
  });

  // The shop builds the tx with lib/solana/usdc.ts; the server verifies it with
  // purchase-verify.ts. A mismatch takes real USDC and credits nothing, so
  // build with a mocked RPC, parse it the way jsonParsed does, and verify.
  console.log('client build = server accept');
  const usdc = await import('../lib/solana/usdc');
  const spl = await import('@solana/spl-token');
  const { USDC_MINT } = await import('../lib/solana/config');
  const asParsed = (t: import('@solana/web3.js').Transaction, blockTime: number) => ({
    blockTime,
    meta: { err: null, innerInstructions: [], postTokenBalances: [] },
    transaction: { message: {
      accountKeys: [{ pubkey: t.feePayer!.toBase58(), signer: true }],
      instructions: t.instructions.map((ix) => {
        if (ix.programId.equals(spl.ASSOCIATED_TOKEN_PROGRAM_ID)) {
          return { program: 'spl-associated-token-account', parsed: { type: ix.data[0] === 1 ? 'createIdempotent' : 'create', info: {} } };
        }
        if (!ix.programId.equals(spl.TOKEN_PROGRAM_ID) || ix.data[0] !== 12) return { programId: ix.programId.toBase58(), accounts: [], data: '' };
        const [src, mint, dest, owner] = ix.keys.map((k) => k.pubkey.toBase58());
        return { program: 'spl-token', parsed: { type: 'transferChecked', info: {
          source: src, mint, destination: dest, authority: owner,
          tokenAmount: { amount: Buffer.from(ix.data).readBigUInt64LE(1).toString() } } } };
      }),
    } },
  });
  const mockConn = (payer: PublicKey, existing: Set<string>) => {
    const ata = spl.getAssociatedTokenAddressSync(USDC_MINT, payer).toBase58();
    const data = Buffer.alloc(spl.ACCOUNT_SIZE);
    spl.AccountLayout.encode({
      mint: USDC_MINT, owner: payer, amount: 100_000_000n, delegateOption: 0, delegate: PublicKey.default, state: 1,
      isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
    }, data);
    return {
      getAccountInfo: async (k: PublicKey) => {
        const s = k.toBase58();
        if (s === ata) return { data, owner: spl.TOKEN_PROGRAM_ID, lamports: 2_039_280, executable: false };
        if (s === VAULT || existing.has(s)) return { data: Buffer.alloc(0), owner: spl.TOKEN_PROGRAM_ID, lamports: 1, executable: false };
        return null;
      },
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
    } as unknown as import('@solana/web3.js').Connection;
  };
  const buyer = new PublicKey(W);
  const friend = Keypair.generate().publicKey;
  const friendAta = spl.getAssociatedTokenAddressSync(USDC_MINT, friend).toBase58();
  const now = Date.now();
  const bt = Math.floor(now / 1000);
  const ifOpen = usdc.purchaseWindowOpen(now);
  await test('no recorded referrer: the shop tx pays vault + team 30% and the server accepts it', async () => {
    if (!ifOpen) return console.log('       (skipped: within 3 min of 00:00 UTC, the shop refuses to build)');
    for (const n of [1, 5, 30]) {
      const t = await usdc.buildTicketPurchaseTx(mockConn(buyer, new Set()), buyer, n, null);
      assert.equal(t.instructions.length, 2);
      const v = verifyPurchaseTx(asParsed(t, bt) as never, W, null, now);
      assert.equal(typeof v, 'object', String(v));
      assert.equal((v as { tickets: number }).tickets, n);
    }
  });
  await test('recorded referrer with no USDC account: ATA is created in the same tx and the server accepts it', async () => {
    if (!ifOpen) return;
    const t = await usdc.buildTicketPurchaseTx(mockConn(buyer, new Set()), buyer, 3, friend.toBase58());
    assert.ok(t.instructions[0].programId.equals(spl.ASSOCIATED_TOKEN_PROGRAM_ID));
    assert.equal(t.instructions[0].data[0], 1, 'createIdempotent');
    const v = verifyPurchaseTx(asParsed(t, bt) as never, W, friend.toBase58(), now);
    assert.deepEqual(v, { tickets: 3, vaultAmount: 2_100_000n, referralAccount: friendAta, blockTimeMs: bt * 1000 });
  });
  await test('recorded referrer with a USDC account: no ATA ix, 5% to it, accepted', async () => {
    if (!ifOpen) return;
    const t = await usdc.buildTicketPurchaseTx(mockConn(buyer, new Set([friendAta])), buyer, 2, friend.toBase58());
    assert.equal(t.instructions.length, 3);
    const v = verifyPurchaseTx(asParsed(t, bt) as never, W, friend.toBase58(), now);
    assert.equal((v as { referralAccount: string }).referralAccount, friendAta);
  });
  await test('referrer = buyer, off-curve or bogus: shop sends no referral leg, server accepts', async () => {
    if (!ifOpen) return;
    const pda = PublicKey.findProgramAddressSync([Buffer.from('x')], cfg.PRIZE_PROGRAM_ID)[0].toBase58();
    for (const r of [W, pda, 'not-a-key']) {
      const t = await usdc.buildTicketPurchaseTx(mockConn(buyer, new Set()), buyer, 1, r);
      assert.equal(t.instructions.length, 2, r);
      assert.equal(typeof verifyPurchaseTx(asParsed(t, bt) as never, W, r === 'not-a-key' ? null : r, now), 'object', r);
    }
  });
  await test('a tx with no referral leg is accepted even when a referrer is recorded (safe fallback)', async () => {
    if (!ifOpen) return;
    const t = await usdc.buildTicketPurchaseTx(mockConn(buyer, new Set()), buyer, 1, null);
    assert.equal(typeof verifyPurchaseTx(asParsed(t, bt) as never, W, friend.toBase58(), now), 'object');
  });
  await test('assertPurchaseShape refuses a tampered tx before signing', async () => {
    if (!ifOpen) return;
    const t = await usdc.buildTicketPurchaseTx(mockConn(buyer, new Set([friendAta])), buyer, 1, friend.toBase58());
    assert.throws(() => usdc.assertPurchaseShape(t, buyer, 1, null), /unexpected recipient/);
    assert.throws(() => usdc.assertPurchaseShape(t, buyer, 2, new PublicKey(friendAta)), /vault amount/);
  });
  await test('the shop refuses to build in the last 3 minutes of a UTC day', () => {
    const mid = Date.parse('2026-10-07T00:00:00Z');
    assert.equal(usdc.purchaseWindowOpen(mid - 60_000), false);
    assert.equal(usdc.purchaseWindowOpen(mid - 4 * 60_000), true);
    assert.equal(usdc.purchaseWindowOpen(mid + 1), true);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
