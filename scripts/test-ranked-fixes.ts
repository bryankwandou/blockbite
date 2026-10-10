/**
 * Ranked fixes H1 / M2 / L3 / L4 (lib/ranked/AUDIT.md "Review 2026-10-06").
 * No database, no RPC, no keys: a throwaway RANKED_SECRET is set below.
 *
 *   npx tsx scripts/test-ranked-fixes.ts
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';

process.env.RANKED_SECRET = randomBytes(32).toString('hex');

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

async function main() {
  const cfg = await import('../lib/ranked/config');
  const seed = await import('../lib/ranked/seed');
  const rules = await import('../lib/ranked/rules');
  const { replayRun } = await import('../lib/ranked/replay');
  const pv = await import('../lib/ranked/purchase-verify');
  type S = import('../lib/ranked/rules').RankedState;

  const DAY = '2030-01-15';
  const DAILY = seed.dailySeed(DAY);

  /** Plays a run the way /start and /play build it: first legal move, deal from runSeed(daily, id). */
  function play(id: string, maxSteps = 400) {
    const rs = seed.runSeed(DAILY, id);
    let s: S = rules.initialState(seed.trayFor(rs, rules.boardToHex(0n), 0));
    const log: { m: [number, number, number][] }[] = [];
    const trays: string[] = [s.tray.join()];
    let batch: [number, number, number][] = [];
    while (!s.over && s.moves < maxSteps) {
      let moved = false;
      for (let slot = 0; slot < 3 && !moved; slot++) {
        const p = s.tray[slot];
        if (p === null) continue;
        for (let row = 0; row < rules.SIZE && !moved; row++) {
          for (let col = 0; col < rules.SIZE && !moved; col++) {
            if (!rules.fits(rules.boardFromHex(s.board), p, row, col)) continue;
            s = rules.applyMove(s, { slot: slot as 0 | 1 | 2, row, col }).state;
            batch.push([slot, row, col]);
            moved = true;
          }
        }
      }
      assert.ok(moved || s.over, 'bot found no move on a live run');
      if (s.over || rules.trayEmpty(s.tray)) {
        log.push({ m: batch });
        batch = [];
        if (!s.over) {
          s = rules.dealTray(s, seed.trayFor(rs, s.board, s.moves));
          trays.push(s.tray.join());
        }
      }
    }
    if (batch.length) log.push({ m: batch });
    return { s, log, trays, rs };
  }

  console.log('H1 per-run trays');
  await test('two runs with identical play get different trays (attempt 1 does not reveal attempt 2)', () => {
    const a = play(randomUUID(), 60);
    const b = play(randomUUID(), 60);
    const same = a.trays.filter((t, i) => b.trays[i] === t).length;
    assert.ok(same < a.trays.length / 2, `${same}/${a.trays.length} trays equal`);
    // same position, different runs: the old (seed, board, moves) dealing would be equal here
    let differ = 0;
    for (let i = 0; i < 50; i++) {
      const pos = [rules.boardToHex(BigInt(i)), i] as const;
      if (seed.trayFor(seed.runSeed(DAILY, 'r1'), ...pos).join() !== seed.trayFor(seed.runSeed(DAILY, 'r2'), ...pos).join()) differ++;
    }
    assert.ok(differ > 40, `only ${differ}/50 positions differ`);
  });
  await test('run seed is deterministic and needs the daily seed (server recompute + public replay)', () => {
    const id = randomUUID();
    assert.equal(seed.runSeed(DAILY, id), seed.runSeed(DAILY, id));
    assert.notEqual(seed.runSeed(DAILY, id), seed.runSeed(seed.dailySeed('2030-01-16'), id));
    const r = play(id);
    assert.deepEqual(replayRun(seed.runSeed(DAILY, id), r.log), r.s, 'replay with (revealed seed, run id) reproduces the run');
    let bare: S | null = null;
    try { bare = replayRun(DAILY, r.log); } catch { /* illegal under other trays: also a mismatch */ }
    assert.notDeepEqual(bare, r.s, 'the bare daily seed must not reproduce a run');
  });

  console.log('L3 midnight');
  await test('a run keeps its start day and is open for PLAY_GRACE_MS after it, then closed', () => {
    const end = Date.parse('2030-01-16T00:00:00Z');
    assert.ok(seed.runOpen(DAY, end - 60_000));
    assert.ok(seed.runOpen(DAY, end + 60_000), 'a run started 23:58 continues past midnight');
    assert.ok(!seed.runOpen(DAY, end + seed.PLAY_GRACE_MS));
    assert.ok(seed.PLAY_GRACE_MS < cfg.RESULTS_GRACE_MS, 'moves stop before results / seed reveal');
  });

  console.log('M2 / L4 purchases');
  const W = Keypair.generate().publicKey.toBase58();
  const REF = Keypair.generate().publicKey.toBase58();
  const REF_ATA = pv.usdcAta(REF)!;
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const VAULT = cfg.PRIZE_VAULT.toBase58();
  const TEAM = cfg.TEAM_USDC_ACCOUNT.toBase58();
  const NOW = Date.parse('2030-01-15T12:00:00Z');
  const xfer = (dest: string, amount: number) => ({
    program: 'spl-token',
    parsed: { type: 'transferChecked', info: { authority: W, destination: dest, mint: USDC, source: 's', tokenAmount: { amount: String(amount) } } },
  });
  const tx = (ixs: unknown[], blockTimeMs: number | null = NOW - 30_000, owner = REF) => ({
    blockTime: blockTimeMs === null ? null : Math.floor(blockTimeMs / 1000),
    meta: { err: null, innerInstructions: [], postTokenBalances: [{ accountIndex: 1, mint: USDC, owner }] },
    transaction: { message: { accountKeys: [{ pubkey: W, signer: true }, { pubkey: ixs.length > 2 ? (ixs[2] as { parsed: { info: { destination: string } } }).parsed.info.destination : 'x', signer: false }], instructions: ixs } },
  });
  const withRef = (dest: string) => [xfer(VAULT, 700_000), xfer(TEAM, 250_000), xfer(dest, 50_000)];

  await test('referral leg must be the recorded referrer\'s USDC ATA', () => {
    const ok = pv.verifyPurchaseTx(tx(withRef(REF_ATA)) as never, W, REF, NOW);
    assert.equal(typeof ok, 'object');
    assert.equal((ok as { referralAccount: string }).referralAccount, REF_ATA);
    const other = Keypair.generate().publicKey.toBase58();
    const accomplice = pv.usdcAta(other)!; // a real USDC ATA, owner not the buyer: accepted before the fix
    assert.match(pv.verifyPurchaseTx(tx(withRef(accomplice), undefined, other) as never, W, REF, NOW) as string, /referrer's USDC/);
    assert.match(pv.verifyPurchaseTx(tx(withRef(accomplice), undefined, other) as never, W, null, NOW) as string, /no referrer/);
    assert.match(pv.verifyPurchaseTx(tx(withRef(REF_ATA)) as never, W, null, NOW) as string, /no referrer/);
    assert.match(pv.verifyPurchaseTx(tx(withRef(pv.usdcAta(W)!), undefined, W) as never, W, W, NOW) as string, /no referrer/);
  });
  await test('without a referral leg the 5% goes to the team (30%), with or without a referrer', () => {
    for (const r of [null, REF]) {
      assert.equal(typeof pv.verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000)]) as never, W, r, NOW), 'object');
      assert.equal(typeof pv.verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 250_000)]) as never, W, r, NOW), 'string');
    }
  });
  await test('pool day = blockTime UTC day; stale, timeless and post-cutoff purchases are refused', () => {
    const bt = Date.parse('2030-01-15T23:59:30Z');
    const v = pv.verifyPurchaseTx(tx([xfer(VAULT, 700_000), xfer(TEAM, 300_000)], bt) as never, W, null, bt + 60_000);
    assert.equal(typeof v, 'object');
    assert.equal(seed.dayOf((v as { blockTimeMs: number }).blockTimeMs), DAY, 'credited after midnight, counted on the day it was paid');
    const plain = [xfer(VAULT, 700_000), xfer(TEAM, 300_000)];
    assert.match(pv.verifyPurchaseTx(tx(plain, null) as never, W, null, NOW) as string, /block time/);
    assert.match(pv.verifyPurchaseTx(tx(plain, NOW - pv.PURCHASE_MAX_AGE_MS - 1000) as never, W, null, NOW) as string, /too old/);
    assert.match(pv.verifyPurchaseTx(tx(plain, bt) as never, W, null, bt + cfg.RESULTS_GRACE_MS) as string, /already final/);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
